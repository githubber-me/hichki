// SQLite storage, using the database built into Node. One file, no server.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt } from 'node:crypto';
import { config } from './config.ts';

mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(join(config.dataDir, 'hichki.sqlite'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS gatherings (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    occasion    TEXT NOT NULL,
    away_name   TEXT NOT NULL,
    host_token  TEXT NOT NULL,
    away_token  TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS members (
    id            TEXT PRIMARY KEY,
    gathering_id  TEXT NOT NULL REFERENCES gatherings(id),
    device_id     TEXT NOT NULL,
    name          TEXT NOT NULL,
    points        INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    UNIQUE (gathering_id, device_id)
  );

  -- A request from the away person, or a voice letter.
  --   kind:    see (Be my eyes), do (Meri taraf se), letter (Jab kholna)
  --   status:  scheduled -> open -> done | closed       (see, do)
  --            scheduled -> locked -> unlocked          (letter)
  --   live_at: when it appears in the room; until: when it stops taking answers
  --   unlock_at: letters only, unlock at this time even without proof
  CREATE TABLE IF NOT EXISTS requests (
    id                 TEXT PRIMARY KEY,
    gathering_id       TEXT NOT NULL REFERENCES gatherings(id),
    kind               TEXT NOT NULL,
    text               TEXT NOT NULL,
    text_original      TEXT,
    language           TEXT,
    audio_file         TEXT,
    transcript         TEXT,
    open_when          TEXT,
    nominee_id         TEXT REFERENCES members(id),
    status             TEXT NOT NULL,
    live_at            INTEGER NOT NULL,
    until              INTEGER,
    unlock_at          INTEGER,
    accepted_proof_id  TEXT,
    fulfilled_at       INTEGER,
    created_at         INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS requests_by_gathering ON requests (gathering_id, live_at);
  CREATE INDEX IF NOT EXISTS requests_by_status ON requests (status, live_at);

  -- Proof sent by a guest: a photo or a voice note.
  CREATE TABLE IF NOT EXISTS proofs (
    id          TEXT PRIMARY KEY,
    request_id  TEXT NOT NULL REFERENCES requests(id),
    member_id   TEXT NOT NULL REFERENCES members(id),
    file        TEXT NOT NULL,
    media       TEXT NOT NULL,
    caption     TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS proofs_by_request ON proofs (request_id, created_at);

  -- Dadi ki kahani: an elder's story, transcribed and translated.
  --   status: processing -> ready | failed
  CREATE TABLE IF NOT EXISTS stories (
    id               TEXT PRIMARY KEY,
    gathering_id     TEXT NOT NULL REFERENCES gatherings(id),
    member_id        TEXT REFERENCES members(id),
    teller           TEXT NOT NULL,
    audio_file       TEXT NOT NULL,
    language         TEXT,
    target_language  TEXT NOT NULL,
    transcript       TEXT,
    translation      TEXT,
    status           TEXT NOT NULL,
    error            TEXT,
    created_at       INTEGER NOT NULL
  );
`);

export type Gathering = {
  id: string;
  name: string;
  occasion: string;
  away_name: string;
  host_token: string;
  away_token: string;
  created_at: number;
};

export type Member = {
  id: string;
  gathering_id: string;
  device_id: string;
  name: string;
  points: number;
  created_at: number;
};

// Short code people can read off a screen: no 0/O or 1/I to mix up.
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function shortCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
  return code;
}

export function secret(): string {
  return randomBytes(16).toString('hex');
}

export function createGathering(name: string, occasion: string, awayName: string): Gathering {
  const gathering: Gathering = {
    id: shortCode(),
    name,
    occasion,
    away_name: awayName,
    host_token: secret(),
    away_token: secret(),
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO gatherings (id, name, occasion, away_name, host_token, away_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    gathering.id,
    gathering.name,
    gathering.occasion,
    gathering.away_name,
    gathering.host_token,
    gathering.away_token,
    gathering.created_at,
  );
  return gathering;
}

export function getGathering(id: string): Gathering | undefined {
  return db.prepare('SELECT * FROM gatherings WHERE id = ?').get(id) as Gathering | undefined;
}

// Joining twice from the same phone returns the same member (and updates the name).
export function joinGathering(gatheringId: string, deviceId: string, name: string): Member {
  const existing = db
    .prepare('SELECT * FROM members WHERE gathering_id = ? AND device_id = ?')
    .get(gatheringId, deviceId) as Member | undefined;

  if (existing) {
    db.prepare('UPDATE members SET name = ? WHERE id = ?').run(name, existing.id);
    return { ...existing, name };
  }

  const member: Member = {
    id: secret(),
    gathering_id: gatheringId,
    device_id: deviceId,
    name,
    points: 0,
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO members (id, gathering_id, device_id, name, points, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(member.id, member.gathering_id, member.device_id, member.name, member.points, member.created_at);
  return member;
}

export function getMember(id: string): Member | undefined {
  return db.prepare('SELECT * FROM members WHERE id = ?').get(id) as Member | undefined;
}

export function listMembers(gatheringId: string): Member[] {
  return db
    .prepare('SELECT * FROM members WHERE gathering_id = ? ORDER BY points DESC, created_at ASC')
    .all(gatheringId) as Member[];
}

export function addPoints(memberId: string, points: number) {
  db.prepare('UPDATE members SET points = points + ? WHERE id = ?').run(points, memberId);
}

// ---------------------------------------------------------------------------
// Requests and letters
// ---------------------------------------------------------------------------

export type RequestKind = 'see' | 'do' | 'letter';
export type RequestStatus = 'scheduled' | 'open' | 'done' | 'closed' | 'locked' | 'unlocked';

export type RequestRow = {
  id: string;
  gathering_id: string;
  kind: RequestKind;
  text: string;
  text_original: string | null;
  language: string | null;
  audio_file: string | null;
  transcript: string | null;
  open_when: string | null;
  nominee_id: string | null;
  status: RequestStatus;
  live_at: number;
  until: number | null;
  unlock_at: number | null;
  accepted_proof_id: string | null;
  fulfilled_at: number | null;
  created_at: number;
};

export type NewRequest = Pick<RequestRow, 'gathering_id' | 'kind' | 'text' | 'live_at'> &
  Partial<
    Pick<
      RequestRow,
      'text_original' | 'language' | 'audio_file' | 'transcript' | 'open_when' | 'nominee_id' | 'until' | 'unlock_at'
    >
  >;

// The status a request should have right now, given its times.
export function startingStatus(kind: RequestKind, liveAt: number, now = Date.now()): RequestStatus {
  if (liveAt > now) return 'scheduled';
  return kind === 'letter' ? 'locked' : 'open';
}

export function createRequest(r: NewRequest): RequestRow {
  const row: RequestRow = {
    id: secret(),
    text_original: null,
    language: null,
    audio_file: null,
    transcript: null,
    open_when: null,
    nominee_id: null,
    until: null,
    unlock_at: null,
    accepted_proof_id: null,
    fulfilled_at: null,
    ...r,
    status: startingStatus(r.kind, r.live_at),
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO requests (id, gathering_id, kind, text, text_original, language, audio_file, transcript,
       open_when, nominee_id, status, live_at, until, unlock_at, accepted_proof_id, fulfilled_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.gathering_id, row.kind, row.text, row.text_original, row.language, row.audio_file, row.transcript,
    row.open_when, row.nominee_id, row.status, row.live_at, row.until, row.unlock_at, row.accepted_proof_id,
    row.fulfilled_at, row.created_at,
  );
  return row;
}

export function getRequest(id: string): RequestRow | undefined {
  return db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as RequestRow | undefined;
}

export function listRequests(gatheringId: string): RequestRow[] {
  return db
    .prepare('SELECT * FROM requests WHERE gathering_id = ? ORDER BY live_at ASC, created_at ASC')
    .all(gatheringId) as RequestRow[];
}

export function setRequestStatus(id: string, status: RequestStatus, extra: Partial<RequestRow> = {}) {
  db.prepare(
    `UPDATE requests SET status = ?,
       accepted_proof_id = COALESCE(?, accepted_proof_id),
       fulfilled_at = COALESCE(?, fulfilled_at),
       transcript = COALESCE(?, transcript)
     WHERE id = ?`,
  ).run(status, extra.accepted_proof_id ?? null, extra.fulfilled_at ?? null, extra.transcript ?? null, id);
}

export function setRequestTranscript(id: string, transcript: string, language: string | null) {
  db.prepare('UPDATE requests SET transcript = ?, language = COALESCE(?, language) WHERE id = ?').run(
    transcript,
    language,
    id,
  );
}

export function cancelRequest(id: string) {
  db.prepare("UPDATE requests SET status = 'closed' WHERE id = ?").run(id);
}

// Requests whose time has come: scheduled ones going live, open ones past their
// deadline, and letters whose unlock time has passed.
export function dueChanges(now = Date.now()) {
  return {
    goingLive: db
      .prepare("SELECT * FROM requests WHERE status = 'scheduled' AND live_at <= ?")
      .all(now) as RequestRow[],
    expiring: db
      .prepare("SELECT * FROM requests WHERE status = 'open' AND until IS NOT NULL AND until <= ?")
      .all(now) as RequestRow[],
    unlocking: db
      .prepare("SELECT * FROM requests WHERE status = 'locked' AND unlock_at IS NOT NULL AND unlock_at <= ?")
      .all(now) as RequestRow[],
  };
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

export type ProofRow = {
  id: string;
  request_id: string;
  member_id: string;
  file: string;
  media: 'photo' | 'audio' | 'video';
  caption: string | null;
  created_at: number;
};

export function createProof(p: Omit<ProofRow, 'id' | 'created_at'>): ProofRow {
  const row: ProofRow = { ...p, id: secret(), created_at: Date.now() };
  db.prepare(
    'INSERT INTO proofs (id, request_id, member_id, file, media, caption, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(row.id, row.request_id, row.member_id, row.file, row.media, row.caption, row.created_at);
  return row;
}

export function getProof(id: string): ProofRow | undefined {
  return db.prepare('SELECT * FROM proofs WHERE id = ?').get(id) as ProofRow | undefined;
}

export function listProofs(gatheringId: string): ProofRow[] {
  return db
    .prepare(
      `SELECT p.* FROM proofs p JOIN requests r ON r.id = p.request_id
       WHERE r.gathering_id = ? ORDER BY p.created_at ASC`,
    )
    .all(gatheringId) as ProofRow[];
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export type StoryRow = {
  id: string;
  gathering_id: string;
  member_id: string | null;
  teller: string;
  audio_file: string;
  language: string | null;
  target_language: string;
  transcript: string | null;
  translation: string | null;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  created_at: number;
};

export function createStory(
  s: Pick<StoryRow, 'gathering_id' | 'member_id' | 'teller' | 'audio_file' | 'language' | 'target_language'>,
): StoryRow {
  const row: StoryRow = {
    ...s,
    id: secret(),
    transcript: null,
    translation: null,
    status: 'processing',
    error: null,
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO stories (id, gathering_id, member_id, teller, audio_file, language, target_language,
       transcript, translation, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.gathering_id, row.member_id, row.teller, row.audio_file, row.language, row.target_language,
    row.transcript, row.translation, row.status, row.error, row.created_at,
  );
  return row;
}

export function updateStory(id: string, fields: Partial<Pick<StoryRow, 'language' | 'transcript' | 'translation' | 'status' | 'error'>>) {
  const current = getStory(id);
  if (!current) return;
  const next = { ...current, ...fields };
  db.prepare(
    'UPDATE stories SET language = ?, transcript = ?, translation = ?, status = ?, error = ? WHERE id = ?',
  ).run(next.language, next.transcript, next.translation, next.status, next.error, id);
}

export function getStory(id: string): StoryRow | undefined {
  return db.prepare('SELECT * FROM stories WHERE id = ?').get(id) as StoryRow | undefined;
}

export function listStories(gatheringId: string): StoryRow[] {
  return db
    .prepare('SELECT * FROM stories WHERE gathering_id = ? ORDER BY created_at ASC')
    .all(gatheringId) as StoryRow[];
}

export function ping(): boolean {
  return (db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1;
}
