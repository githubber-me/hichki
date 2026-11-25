// The shared Fastify app and Socket.IO server. Other modules import these.

import Fastify from 'fastify';
import { Server } from 'socket.io';
import { config } from './config.ts';

// JSON logs on stdout, so Kubernetes and NudgeBee can read them.
export const app = Fastify({
  logger: { level: config.logLevel },
  bodyLimit: 1024 * 1024,
});

export const log = app.log;

export const io = new Server(app.server, { cors: { origin: false } });
