// Live updates over Socket.IO.
//
// Each gathering has two socket rooms:
//   room:  guests and the host. They never see scheduled requests or the
//          audio of a locked letter, so surprises stay surprises.
//   away:  the person who couldn't come. They see everything they've set up.

import type { Socket } from 'socket.io';
import { io, log } from './app.ts';
import { getGathering, getMember, listMembers, type RequestRow } from './db.ts';
import { flags, onFlagsChange } from './flags.ts';
import { requestView } from './views.ts';

const roomOf = (gatheringId: string) => `g:${gatheringId}:room`;
const awayOf = (gatheringId: string) => `g:${gatheringId}:away`;

// Open sockets per gathering: member id -> count, and the away person's count.
const online = new Map<string, Map<string, number>>();
const awayOnline = new Map<string, number>();

export function presence(gatheringId: string) {
  const counts = online.get(gatheringId) ?? new Map<string, number>();
  return {
    members: listMembers(gatheringId).map((m) => ({
      id: m.id,
      name: m.name,
      points: m.points,
      online: (counts.get(m.id) ?? 0) > 0,
    })),
    awayOnline: (awayOnline.get(gatheringId) ?? 0) > 0,
  };
}

export function onlineMemberIds(gatheringId: string): string[] {
  const counts = online.get(gatheringId) ?? new Map<string, number>();
  return [...counts.entries()].filter(([, n]) => n > 0).map(([id]) => id);
}

export function broadcastPresence(gatheringId: string) {
  const p = presence(gatheringId);
  io.to(roomOf(gatheringId)).to(awayOf(gatheringId)).emit('presence', p);
}

// Send one event to the room (guests and host) and the away person, each with their own view.
export function emitSplit<T>(gatheringId: string, event: string, roomView: T | null, awayView: T) {
  if (roomView !== null) io.to(roomOf(gatheringId)).emit(event, roomView);
  io.to(awayOf(gatheringId)).emit(event, awayView);
}

// Tell everyone about a request that changed, each with their own view.
export function publishRequest(r: RequestRow) {
  emitSplit(r.gathering_id, 'request', requestView(r, 'room'), requestView(r, 'away'));
}

export function emitAll(gatheringId: string, event: string, payload: unknown) {
  io.to(roomOf(gatheringId)).to(awayOf(gatheringId)).emit(event, payload);
}

export function emitAway(gatheringId: string, event: string, payload: unknown) {
  io.to(awayOf(gatheringId)).emit(event, payload);
}

// A flag flipped in Flagsmith: tell every phone in every gathering.
onFlagsChange((next) => io.emit('flags', next));

function bump(map: Map<string, number>, key: string, by: number) {
  map.set(key, Math.max(0, (map.get(key) ?? 0) + by));
}

// A phone connects with { gatheringId, role, memberId | token }.
// Guests prove who they are with their member id, host and away with their token.
io.on('connection', (socket: Socket) => {
  const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
  const g = getGathering(String(auth.gatheringId ?? '').toUpperCase());
  const role = String(auth.role ?? '');

  const refuse = (error: string) => {
    socket.emit('fatal', { error });
    socket.disconnect(true);
  };

  if (!g) return refuse('No gathering with that code.');

  let memberId: string | null = null;

  if (role === 'guest') {
    const member = getMember(String(auth.memberId ?? ''));
    if (!member || member.gathering_id !== g.id) return refuse('Join the gathering first.');
    memberId = member.id;
    const counts = online.get(g.id) ?? new Map<string, number>();
    bump(counts, memberId, 1);
    online.set(g.id, counts);
    socket.join(roomOf(g.id));
  } else if (role === 'host') {
    if (auth.token !== g.host_token) return refuse('This link has expired.');
    socket.join(roomOf(g.id));
  } else if (role === 'away') {
    if (auth.token !== g.away_token) return refuse('This link has expired.');
    bump(awayOnline, g.id, 1);
    socket.join(awayOf(g.id));
  } else {
    return refuse('Unknown role.');
  }

  log.info({ event: 'socket_connected', gatheringId: g.id, role }, 'socket connected');
  socket.emit('flags', flags());
  broadcastPresence(g.id);

  socket.on('disconnect', () => {
    if (memberId) bump(online.get(g.id) ?? new Map(), memberId, -1);
    if (role === 'away') bump(awayOnline, g.id, -1);
    broadcastPresence(g.id);
  });
});
