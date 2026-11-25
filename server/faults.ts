// Break the app on purpose, so NudgeBee has a real problem to investigate.
// Off unless BREAK is set. deploy/break.sh and deploy/fix.sh switch it on the cluster.
//
//   BREAK=uploads  The uploads folder is made read-only, so every photo and voice
//                  note fails with a real EACCES error and an HTTP 500.
//   BREAK=memory   The server keeps allocating memory it never frees, until
//                  Kubernetes kills the pod for going over its 512Mi limit (OOMKilled).
//
// With BREAK unset, the uploads folder is made writable again.

import { chmodSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './app.ts';
import { config } from './config.ts';
import { uploadsDir } from './files.ts';

function setUploadsMode(mode: number) {
  chmodSync(uploadsDir, mode);
  for (const entry of readdirSync(uploadsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) chmodSync(join(uploadsDir, entry.name), mode);
  }
}

const leaked: Buffer[] = [];

export function applyFaults() {
  const mode = config.break;

  try {
    setUploadsMode(mode === 'uploads' ? 0o555 : 0o755);
  } catch (err) {
    log.warn({ event: 'fault_chmod_failed', err: (err as Error).message }, 'could not change uploads folder mode');
  }

  if (!mode) return;
  log.warn({ event: 'fault_on', fault: mode }, `fault injection is on: ${mode}`);

  if (mode === 'memory') {
    // About 16 MB every 2 seconds: the 512Mi limit is reached in roughly a minute.
    setInterval(() => {
      leaked.push(Buffer.alloc(16 * 1024 * 1024, 1));
      const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
      log.warn({ event: 'cache_grow', entries: leaked.length, rssMb }, 'media cache grew');
    }, 2000);
  }
}
