// Releases scheduled requests when their time comes, closes ones past their
// deadline, and opens letters set to unlock at a time. Runs every few seconds,
// so a gathering planned on Wednesday plays out by itself through the week.

import { log } from './app.ts';
import { dueChanges, getRequest, setRequestStatus } from './db.ts';
import { publishRequest } from './live.ts';

const TICK_MS = 5_000;

export function tick(now = Date.now()) {
  const { goingLive, expiring, unlocking } = dueChanges(now);

  for (const r of goingLive) {
    setRequestStatus(r.id, r.kind === 'letter' ? 'locked' : 'open');
    log.info({ event: 'request_live', gatheringId: r.gathering_id, requestId: r.id, kind: r.kind }, 'scheduled request went live');
  }
  for (const r of expiring) {
    setRequestStatus(r.id, 'closed');
    log.info({ event: 'request_closed', gatheringId: r.gathering_id, requestId: r.id }, 'request reached its end time');
  }
  for (const r of unlocking) {
    setRequestStatus(r.id, 'unlocked', { fulfilled_at: now });
    log.info({ event: 'letter_unlocked', gatheringId: r.gathering_id, requestId: r.id }, 'letter unlocked by time');
  }

  for (const r of [...goingLive, ...expiring, ...unlocking]) {
    const updated = getRequest(r.id);
    if (updated) publishRequest(updated);
  }
}

let timer: NodeJS.Timeout | null = null;

export function startScheduler() {
  tick();
  timer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      log.error({ event: 'scheduler_failed', err: (err as Error).message }, 'scheduler tick failed');
    }
  }, TICK_MS);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
}
