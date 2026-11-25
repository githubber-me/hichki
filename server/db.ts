// SQLite storage, using the database built into Node. One file, no server.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, randomInt } from 'node:crypto';
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

  -- Every hichki tap, kept so the yaadein page can show each time someone remembered.
  CREATE TABLE IF NOT EXISTS hichkis (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    gathering_id  TEXT NOT NULL REFERENCES gatherings(id),
    member_id     TEXT REFERENCES members(id),
    from_name     TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS hichkis_by_gathering ON hichkis (gathering_id, created_at);
`);

// wrapped_at: when the host said the celebration is over. Added after the first
// gatherings were created, so older database files get the column here.
const gatheringColumns = db.prepare('PRAGMA table_info(gatherings)').all() as { name: string }[];
if (!gatheringColumns.some((c) => c.name === 'wrapped_at')) {
  db.exec('ALTER TABLE gatherings ADD COLUMN wrapped_at INTEGER');
}

// Verified gatherings: guests must sign in (Google or phone, through Clerk) to join.
if (!gatheringColumns.some((c) => c.name === 'verified')) {
  db.exec('ALTER TABLE gatherings ADD COLUMN verified INTEGER NOT NULL DEFAULT 0');
}

// Duty pe: the away person can be on duty (a shift, a posting, a delivery run).
//   duty_from / duty_until: the current or last duty; hichkis are held during it.
//   duty_note: what they're doing, shown to the room ("night shift at the hospital").
//   away_seen_at: when the away person last left, for "while you were away".
for (const [column, type] of [
  ['duty_from', 'INTEGER'],
  ['duty_until', 'INTEGER'],
  ['duty_note', 'TEXT'],
  ['away_seen_at', 'INTEGER'],
  // The away person's timezone, saved from their phone, so the room can see their clock.
  ['away_tz', 'TEXT'],
  // The room's language for feature names ("Jab kholna" or "Open when"). Hindi by default.
  ['room_lang', "TEXT NOT NULL DEFAULT 'hi'"],
  // Why the away person can't come: nurse, doctor, soldier, shift, visa, far, unwell, other.
  ['away_reason', 'TEXT'],
  // The whole room reads translated into this language ('' means as it was said).
  ['read_lang', "TEXT NOT NULL DEFAULT ''"],
] as const) {
  if (!gatheringColumns.some((c) => c.name === column)) db.exec(`ALTER TABLE gatherings ADD COLUMN ${column} ${type}`);
}

// More than one person can be away. The first (the "main" one) lives on the
// gathering itself; everyone else who couldn't come is a row here, with their own
// private link, reason, timezone, duty and last visit.
db.exec(`
  CREATE TABLE IF NOT EXISTS away_people (
    id           TEXT PRIMARY KEY,
    gathering_id TEXT NOT NULL REFERENCES gatherings(id),
    name         TEXT NOT NULL,
    token        TEXT NOT NULL,
    reason       TEXT,
    tz           TEXT,
    duty_from    INTEGER,
    duty_until   INTEGER,
    duty_note    TEXT,
    seen_at      INTEGER,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS away_people_by_gathering ON away_people (gathering_id, created_at);
`);

// Who asked (null = the main away person), and who a hichki was for (null = main,
// 'all' = everyone away, or an away person's id).
const requestColumns = db.prepare('PRAGMA table_info(requests)').all() as { name: string }[];
for (const [column, type] of [['asked_by', 'TEXT'], ['asked_by_name', 'TEXT']] as const) {
  if (!requestColumns.some((c) => c.name === column)) db.exec(`ALTER TABLE requests ADD COLUMN ${column} ${type}`);
}
const hichkiCols = db.prepare('PRAGMA table_info(hichkis)').all() as { name: string }[];
if (!hichkiCols.some((c) => c.name === 'to_away')) db.exec('ALTER TABLE hichkis ADD COLUMN to_away TEXT');

export type Away = {
  id: string; // 'main' for the gathering's own away person
  name: string;
  token: string;
  reason: string | null;
  tz: string | null;
  duty_from: number | null;
  duty_until: number | null;
  duty_note: string | null;
  seen_at: number | null;
};

type AwayRow = Away & { gathering_id: string; created_at: number };

function mainAway(g: Gathering): Away {
  return {
    id: 'main',
    name: g.away_name,
    token: g.away_token,
    reason: g.away_reason ?? null,
    tz: g.away_tz ?? null,
    duty_from: g.duty_from ?? null,
    duty_until: g.duty_until ?? null,
    duty_note: g.duty_note ?? null,
    seen_at: g.away_seen_at ?? null,
  };
}

// Everyone who couldn't come: the main person first, then the rest in order added.
export function awayPeople(g: Gathering): Away[] {
  const others = db.prepare('SELECT * FROM away_people WHERE gathering_id = ? ORDER BY created_at ASC').all(g.id) as AwayRow[];
  return [mainAway(g), ...others];
}

export function awayByToken(g: Gathering, token: string): Away | undefined {
  if (token === g.away_token) return mainAway(g);
  return db.prepare('SELECT * FROM away_people WHERE gathering_id = ? AND token = ?').get(g.id, token) as AwayRow | undefined;
}

export function awayById(g: Gathering, id: string | null | undefined): Away | undefined {
  if (!id || id === 'main') return mainAway(g);
  return db.prepare('SELECT * FROM away_people WHERE gathering_id = ? AND id = ?').get(g.id, id) as AwayRow | undefined;
}

export function addAwayPerson(gatheringId: string, name: string, reason: string | null): Away {
  const row: AwayRow = {
    id: secret().slice(0, 12),
    gathering_id: gatheringId,
    name,
    token: secret(),
    reason,
    tz: null,
    duty_from: null,
    duty_until: null,
    duty_note: null,
    seen_at: null,
    created_at: Date.now(),
  };
  db.prepare('INSERT INTO away_people (id, gathering_id, name, token, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    row.id, row.gathering_id, row.name, row.token, row.reason, row.created_at,
  );
  return row;
}

export function onDutyAway(a: Away, now = Date.now()): boolean {
  return !!a.duty_until && !!a.duty_from && a.duty_from <= now && now < a.duty_until;
}

// Duty, timezone and last visit, for whichever away person.
export function setAwayDuty(g: Gathering, awayId: string, until: number | null, note: string | null) {
  if (awayId === 'main') return setDuty(g.id, until, note);
  if (until) db.prepare('UPDATE away_people SET duty_from = ?, duty_until = ?, duty_note = ? WHERE id = ?').run(Date.now(), until, note, awayId);
  else db.prepare('UPDATE away_people SET duty_until = ? WHERE id = ?').run(Date.now(), awayId);
}

export function markSeen(g: Gathering, awayId: string, at = Date.now()) {
  if (awayId === 'main') return markAwaySeen(g.id, at);
  db.prepare('UPDATE away_people SET seen_at = ?, duty_from = CASE WHEN duty_until <= ? THEN NULL ELSE duty_from END WHERE id = ?').run(at, at, awayId);
}

export function setTzFor(g: Gathering, awayId: string, tz: string) {
  if (awayId === 'main') return setAwayTz(g.id, tz);
  db.prepare('UPDATE away_people SET tz = ? WHERE id = ?').run(tz, awayId);
}

// Translations, cached: each text is translated once per language.
db.exec(`
  CREATE TABLE IF NOT EXISTS translations (
    source  TEXT NOT NULL,
    target  TEXT NOT NULL,
    result  TEXT NOT NULL,
    PRIMARY KEY (source, target)
  );
`);

export function cachedTranslation(source: string, target: string): string | undefined {
  return (db.prepare('SELECT result FROM translations WHERE source = ? AND target = ?').get(source, target) as { result: string } | undefined)?.result;
}

export function saveTranslation(source: string, target: string, result: string) {
  db.prepare('INSERT OR REPLACE INTO translations (source, target, result) VALUES (?, ?, ?)').run(source, target, result);
}

// A hichki can carry a short line: "I thought of you when Dadi started singing".
const hichkiColumns = db.prepare('PRAGMA table_info(hichkis)').all() as { name: string }[];
if (!hichkiColumns.some((c) => c.name === 'note')) db.exec('ALTER TABLE hichkis ADD COLUMN note TEXT');

// A story told in answer to a request ("Ask Dadi about her wedding day") is linked to it.
const storyColumns = db.prepare('PRAGMA table_info(stories)').all() as { name: string }[];
if (!storyColumns.some((c) => c.name === 'request_id')) db.exec('ALTER TABLE stories ADD COLUMN request_id TEXT');

// A thank-you from the away person on the proof they picked: text, or a voice or video note.
const proofColumns = db.prepare('PRAGMA table_info(proofs)').all() as { name: string }[];
for (const [column, type] of [
  ['thanks_text', 'TEXT'],
  ['thanks_file', 'TEXT'],
  ['thanks_at', 'INTEGER'],
  // Hearts: the away person can love any number of answers (+5 each).
  ['loved_at', 'INTEGER'],
  // Set aside: folded away on the away person's screen only. The sender is never told.
  ['set_aside', 'INTEGER'],
] as const) {
  if (!proofColumns.some((c) => c.name === column)) db.exec(`ALTER TABLE proofs ADD COLUMN ${column} ${type}`);
}

// Members who signed in carry their sign-in account and photo. removed_at is set
// when the host removes someone; their link stops working and they leave the lists.
const memberColumns = db.prepare('PRAGMA table_info(members)').all() as { name: string }[];
for (const [column, type] of [
  ['auth_user_id', 'TEXT'],
  ['avatar_url', 'TEXT'],
  ['removed_at', 'INTEGER'],
] as const) {
  if (!memberColumns.some((c) => c.name === column)) db.exec(`ALTER TABLE members ADD COLUMN ${column} ${type}`);
}

export type Gathering = {
  id: string;
  name: string;
  occasion: string;
  away_name: string;
  host_token: string;
  away_token: string;
  created_at: number;
  wrapped_at: number | null;
  verified: number; // 1 when guests must sign in to join
  duty_from: number | null;
  duty_until: number | null;
  duty_note: string | null;
  away_seen_at: number | null;
  away_tz: string | null;
  room_lang: string;
  away_reason: string | null;
  read_lang: string;
};

export type Member = {
  id: string;
  gathering_id: string;
  device_id: string;
  name: string;
  points: number;
  created_at: number;
  auth_user_id: string | null;
  avatar_url: string | null;
  removed_at: number | null;
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

export function createGathering(name: string, occasion: string, awayName: string, verified = false): Gathering {
  const gathering: Gathering = {
    id: shortCode(),
    name,
    occasion,
    away_name: awayName,
    host_token: secret(),
    away_token: secret(),
    created_at: Date.now(),
    wrapped_at: null,
    verified: verified ? 1 : 0,
    duty_from: null,
    duty_until: null,
    duty_note: null,
    away_seen_at: null,
    away_tz: null,
    room_lang: 'hi',
    away_reason: null,
    read_lang: '',
  };
  db.prepare(
    `INSERT INTO gatherings (id, name, occasion, away_name, host_token, away_token, created_at, verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    gathering.id,
    gathering.name,
    gathering.occasion,
    gathering.away_name,
    gathering.host_token,
    gathering.away_token,
    gathering.created_at,
    gathering.verified,
  );
  return gathering;
}

export function onDuty(g: Gathering, now = Date.now()): boolean {
  return !!g.duty_until && !!g.duty_from && g.duty_from <= now && now < g.duty_until;
}

// Start duty (until a time), or end it now (until = null keeps duty_from for the catch-up).
export function setDuty(id: string, until: number | null, note: string | null) {
  if (until) {
    db.prepare('UPDATE gatherings SET duty_from = ?, duty_until = ?, duty_note = ? WHERE id = ?').run(Date.now(), until, note, id);
  } else {
    db.prepare('UPDATE gatherings SET duty_until = ? WHERE id = ?').run(Date.now(), id);
  }
}

// The away person has caught up: next time, only show what's new after now.
export function markAwaySeen(id: string, at = Date.now()) {
  db.prepare('UPDATE gatherings SET away_seen_at = ?, duty_from = CASE WHEN duty_until <= ? THEN NULL ELSE duty_from END WHERE id = ?').run(at, at, id);
}

// Host settings that can change after creating the gathering.
export function setSettings(id: string, s: { roomLang?: string; readLang?: string; awayReason?: string | null }) {
  if (s.roomLang !== undefined) db.prepare('UPDATE gatherings SET room_lang = ? WHERE id = ?').run(s.roomLang, id);
  if (s.readLang !== undefined) db.prepare('UPDATE gatherings SET read_lang = ? WHERE id = ?').run(s.readLang, id);
  if (s.awayReason !== undefined) db.prepare('UPDATE gatherings SET away_reason = ? WHERE id = ?').run(s.awayReason, id);
}

export function setRoomLang(id: string, lang: string) {
  db.prepare('UPDATE gatherings SET room_lang = ? WHERE id = ?').run(lang, id);
}

export function setAwayTz(id: string, tz: string) {
  db.prepare('UPDATE gatherings SET away_tz = ? WHERE id = ?').run(tz, id);
}

export function setVerified(id: string, verified: boolean) {
  db.prepare('UPDATE gatherings SET verified = ? WHERE id = ?').run(verified ? 1 : 0, id);
}

export function getGathering(id: string): Gathering | undefined {
  return db.prepare('SELECT * FROM gatherings WHERE id = ?').get(id) as Gathering | undefined;
}

// Wrapping up doesn't lock anything. It only says the celebration is over, so
// the away person's link opens on their yaadein. Passing null reopens it.
export function setWrapped(id: string, at: number | null) {
  db.prepare('UPDATE gatherings SET wrapped_at = ? WHERE id = ?').run(at, id);
}

// The key in the read-only yaadein link. It is worked out from the two private
// tokens, so it can't be guessed and can't be turned back into either of them.
export function keepsakeKey(g: Gathering): string {
  return createHmac('sha256', g.host_token).update(`yaadein:${g.id}:${g.away_token}`).digest('hex').slice(0, 24);
}

// Someone already in this gathering with this name (any letter case), other than
// the given member. Names must be unique, so nobody can pass as someone else.
export function memberWithName(gatheringId: string, name: string, exceptId: string | null = null): Member | undefined {
  return db
    .prepare(
      `SELECT * FROM members WHERE gathering_id = ? AND removed_at IS NULL
         AND lower(name) = lower(?) AND id IS NOT ?`,
    )
    .get(gatheringId, name, exceptId) as Member | undefined;
}

export function memberByDevice(gatheringId: string, deviceId: string): Member | undefined {
  return db
    .prepare('SELECT * FROM members WHERE gathering_id = ? AND device_id = ?')
    .get(gatheringId, deviceId) as Member | undefined;
}

export function memberByAuthUser(gatheringId: string, authUserId: string): Member | undefined {
  return db
    .prepare('SELECT * FROM members WHERE gathering_id = ? AND auth_user_id = ?')
    .get(gatheringId, authUserId) as Member | undefined;
}

// Joining twice from the same phone (or, when signed in, the same account on any
// phone) returns the same member and updates the name.
export function joinGathering(
  gatheringId: string,
  deviceId: string,
  name: string,
  auth: { userId: string; avatarUrl: string | null } | null = null,
): Member {
  const existing = auth ? memberByAuthUser(gatheringId, auth.userId) : memberByDevice(gatheringId, deviceId);

  if (existing && auth) {
    // A signed-in guest on another phone: keep the name and photo they chose.
    db.prepare('UPDATE members SET device_id = ? WHERE id = ?').run(deviceId, existing.id);
    return { ...existing, device_id: deviceId };
  }
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
    auth_user_id: auth?.userId ?? null,
    avatar_url: auth?.avatarUrl ?? null,
    removed_at: null,
  };
  db.prepare(
    `INSERT INTO members (id, gathering_id, device_id, name, points, created_at, auth_user_id, avatar_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    member.id, member.gathering_id, member.device_id, member.name, member.points, member.created_at,
    member.auth_user_id, member.avatar_url,
  );
  return member;
}

// A guest changes how they appear: their name, and their photo (a URL, or null for none).
export function updateProfile(id: string, name: string, avatarUrl: string | null) {
  db.prepare('UPDATE members SET name = ?, avatar_url = ? WHERE id = ?').run(name, avatarUrl, id);
}

export function removeMember(id: string) {
  db.prepare('UPDATE members SET removed_at = ? WHERE id = ?').run(Date.now(), id);
}

export function getMember(id: string): Member | undefined {
  return db.prepare('SELECT * FROM members WHERE id = ?').get(id) as Member | undefined;
}

export function listMembers(gatheringId: string): Member[] {
  return db
    .prepare('SELECT * FROM members WHERE gathering_id = ? AND removed_at IS NULL ORDER BY points DESC, created_at ASC')
    .all(gatheringId) as Member[];
}

export function addPoints(memberId: string, points: number) {
  db.prepare('UPDATE members SET points = points + ? WHERE id = ?').run(points, memberId);
}

// ---------------------------------------------------------------------------
// Requests and letters
// ---------------------------------------------------------------------------

// story: Dadi ki kahani, the away person asks someone at the gathering to tell a story.
export type RequestKind = 'see' | 'do' | 'letter' | 'story';
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
  asked_by?: string | null;
  asked_by_name?: string | null;
};

export type NewRequest = Pick<RequestRow, 'gathering_id' | 'kind' | 'text' | 'live_at'> &
  Partial<
    Pick<
      RequestRow,
      'text_original' | 'language' | 'audio_file' | 'transcript' | 'open_when' | 'nominee_id' | 'until' | 'unlock_at' | 'asked_by' | 'asked_by_name'
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
       open_when, nominee_id, status, live_at, until, unlock_at, accepted_proof_id, fulfilled_at, created_at,
       asked_by, asked_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.gathering_id, row.kind, row.text, row.text_original, row.language, row.audio_file, row.transcript,
    row.open_when, row.nominee_id, row.status, row.live_at, row.until, row.unlock_at, row.accepted_proof_id,
    row.fulfilled_at, row.created_at, row.asked_by ?? null, row.asked_by_name ?? null,
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
  thanks_text?: string | null;
  thanks_file?: string | null;
  thanks_at?: number | null;
  loved_at?: number | null;
  set_aside?: number | null;
};

export function setLoved(proofId: string, loved: boolean) {
  db.prepare('UPDATE proofs SET loved_at = ?, set_aside = CASE WHEN ? THEN 0 ELSE set_aside END WHERE id = ?').run(loved ? Date.now() : null, loved ? 1 : 0, proofId);
}

export function setAside(proofId: string, aside: boolean) {
  db.prepare('UPDATE proofs SET set_aside = ? WHERE id = ?').run(aside ? 1 : 0, proofId);
}

export function setThanks(proofId: string, text: string | null, file: string | null) {
  db.prepare('UPDATE proofs SET thanks_text = ?, thanks_file = ?, thanks_at = ? WHERE id = ?').run(text, file, Date.now(), proofId);
}

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
  request_id?: string | null;
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
  s: Pick<StoryRow, 'gathering_id' | 'member_id' | 'teller' | 'audio_file' | 'language' | 'target_language'> & { request_id?: string | null },
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
       transcript, translation, status, error, created_at, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.gathering_id, row.member_id, row.teller, row.audio_file, row.language, row.target_language,
    row.transcript, row.translation, row.status, row.error, row.created_at, row.request_id ?? null,
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

// ---------------------------------------------------------------------------
// Hichkis
// ---------------------------------------------------------------------------

export type HichkiRow = { id: number; gathering_id: string; member_id: string | null; from_name: string; created_at: number; note: string | null; to_away?: string | null };

export function addHichki(gatheringId: string, memberId: string | null, fromName: string, at = Date.now(), note: string | null = null, toAway: string | null = null) {
  db.prepare('INSERT INTO hichkis (gathering_id, member_id, from_name, created_at, note, to_away) VALUES (?, ?, ?, ?, ?, ?)').run(
    gatheringId,
    memberId,
    fromName,
    at,
    note,
    toAway,
  );
}

// The latest hichkis, newest first, for the timeline in the room.
export function recentHichkis(gatheringId: string, limit = 60): HichkiRow[] {
  return db
    .prepare('SELECT * FROM hichkis WHERE gathering_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(gatheringId, limit) as HichkiRow[];
}

export function listHichkisSince(gatheringId: string, since: number): HichkiRow[] {
  return db
    .prepare('SELECT * FROM hichkis WHERE gathering_id = ? AND created_at > ? ORDER BY created_at ASC')
    .all(gatheringId, since) as HichkiRow[];
}

export function listHichkis(gatheringId: string): HichkiRow[] {
  return db
    .prepare('SELECT * FROM hichkis WHERE gathering_id = ? ORDER BY created_at ASC')
    .all(gatheringId) as HichkiRow[];
}

export function ping(): boolean {
  return (db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1;
}
