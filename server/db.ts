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

function secret(): string {
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
