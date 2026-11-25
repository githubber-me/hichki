// Hichki server entry: wires up the API, live updates, uploads and the web page.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { app, io, log } from './app.ts';
import { config } from './config.ts';
import { applyFaults } from './faults.ts';
import { uploadsDir } from './files.ts';
import { startFlags, stopFlags } from './flags.ts';
import { startScheduler, stopScheduler } from './scheduler.ts';
import './live.ts';

await app.register(fastifyMultipart, {
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1, fields: 5 },
});

await import('./routes.ts');

// Uploaded photos and recordings. Names are random, so links can't be guessed.
await app.register(fastifyStatic, {
  root: uploadsDir,
  prefix: '/media/',
  decorateReply: false,
  maxAge: '7d',
  immutable: true,
});

// The built web page. In development, Vite serves it instead.
const webRoot = resolve('dist/web');
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot, wildcard: false });
  // Any other page path loads the app, which reads the address itself.
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/media/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });
}

applyFaults();
await startFlags();
startScheduler();
await app.listen({ port: config.port, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    log.info({ event: 'shutdown', signal }, 'shutting down');
    stopScheduler();
    io.close();
    await stopFlags();
    await app.close();
    process.exit(0);
  });
}
