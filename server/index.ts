// Hichki server: the REST API, live updates over Socket.IO, and the built web page.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import { config } from './config.ts';
import { createGathering, getGathering, getMember, joinGathering, listMembers, type Gathering } from './db.ts';

// JSON logs on stdout, so Kubernetes and NudgeBee can read them.
const app = Fastify({ logger: { level: config.logLevel } });

const io = new Server(app.server, { cors: { origin: false } });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// What anyone with the gathering code may see. Never includes the tokens.
function publicGathering(g: Gathering) {
  return { id: g.id, name: g.name, occasion: g.occasion, awayName: g.away_name };
}

// Who is connected right now: member id -> number of open sockets.
const online = new Map<string, Map<string, number>>();
const awayOnline = new Map<string, number>();

function roomOf(gatheringId: string) {
  return `g:${gatheringId}`;
}

function presence(gatheringId: string) {
  const counts = online.get(gatheringId) ?? new Map();
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

function broadcastPresence(gatheringId: string) {
  io.to(roomOf(gatheringId)).emit('presence', presence(gatheringId));
}

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

app.get('/api/health', async () => ({ ok: true }));

app.get('/api/config', async () => ({ publicBaseUrl: config.publicBaseUrl }));

app.post('/api/gatherings', async (req, reply) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = clean(body.name, 80);
  const occasion = clean(body.occasion, 40) || 'gathering';
  const awayName = clean(body.awayName, 40);

  if (!name || !awayName) {
    return reply.code(400).send({ error: 'Give the gathering a name and say who couldn’t come.' });
  }

  const g = createGathering(name, occasion, awayName);
  req.log.info({ event: 'gathering_created', gatheringId: g.id, occasion: g.occasion }, 'gathering created');
  return { gathering: publicGathering(g), hostToken: g.host_token, awayToken: g.away_token };
});

app.get('/api/gatherings/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const g = getGathering(id.toUpperCase());
  if (!g) return reply.code(404).send({ error: 'No gathering with that code.' });
  return { gathering: publicGathering(g) };
});

app.post('/api/gatherings/:id/join', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as Record<string, unknown>;
  const g = getGathering(id.toUpperCase());
  if (!g) return reply.code(404).send({ error: 'No gathering with that code.' });

  const deviceId = clean(body.deviceId, 64);
  const name = clean(body.name, 40);
  if (!deviceId || !name) return reply.code(400).send({ error: 'Enter your name to join.' });

  const member = joinGathering(g.id, deviceId, name);
  req.log.info({ event: 'member_joined', gatheringId: g.id, memberId: member.id }, 'member joined');
  broadcastPresence(g.id);
  return { member: { id: member.id, name: member.name, points: member.points } };
});

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

// A phone connects with { gatheringId, role, memberId | token }.
// Guests prove who they are with their member id, host and away with their token.
io.on('connection', (socket) => {
  const auth = socket.handshake.auth as Record<string, unknown>;
  const g = getGathering(clean(auth.gatheringId, 12).toUpperCase());
  const role = clean(auth.role, 10);

  if (!g) {
    socket.emit('fatal', { error: 'No gathering with that code.' });
    return socket.disconnect(true);
  }

  let memberId: string | null = null;

  if (role === 'guest') {
    const member = getMember(clean(auth.memberId, 64));
    if (!member || member.gathering_id !== g.id) {
      socket.emit('fatal', { error: 'Join the gathering first.' });
      return socket.disconnect(true);
    }
    memberId = member.id;
    const counts = online.get(g.id) ?? new Map<string, number>();
    counts.set(memberId, (counts.get(memberId) ?? 0) + 1);
    online.set(g.id, counts);
  } else if (role === 'away') {
    if (auth.token !== g.away_token) {
      socket.emit('fatal', { error: 'This link has expired.' });
      return socket.disconnect(true);
    }
    awayOnline.set(g.id, (awayOnline.get(g.id) ?? 0) + 1);
  } else if (role === 'host') {
    if (auth.token !== g.host_token) {
      socket.emit('fatal', { error: 'This link has expired.' });
      return socket.disconnect(true);
    }
  } else {
    return socket.disconnect(true);
  }

  socket.join(roomOf(g.id));
  app.log.info({ event: 'socket_connected', gatheringId: g.id, role }, 'socket connected');
  broadcastPresence(g.id);

  socket.on('disconnect', () => {
    if (memberId) {
      const counts = online.get(g.id);
      counts?.set(memberId, Math.max(0, (counts.get(memberId) ?? 1) - 1));
    } else if (role === 'away') {
      awayOnline.set(g.id, Math.max(0, (awayOnline.get(g.id) ?? 1) - 1));
    }
    broadcastPresence(g.id);
  });
});

// ---------------------------------------------------------------------------
// Web page (production build). In development, Vite serves it instead.
// ---------------------------------------------------------------------------

const webRoot = resolve('dist/web');

if (existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot });
  // Any unknown page path loads the app, which then reads the URL itself.
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Not found' });
  });
}

// ---------------------------------------------------------------------------
// Start and stop
// ---------------------------------------------------------------------------

await app.listen({ port: config.port, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info({ event: 'shutdown', signal }, 'shutting down');
    io.close();
    await app.close();
    process.exit(0);
  });
}
