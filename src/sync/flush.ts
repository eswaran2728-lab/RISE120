import { QuotaLimitError } from '../monetization/errors';
import { listPending, markBlocked, removeIfUnchanged } from './queue';
import type { SyncResult, SyncTransport } from './types';

// One flush per account at a time; concurrent callers share the running flush.
const inFlight = new Map<string, Promise<SyncResult>>();

async function run(userId: string, transport: SyncTransport): Promise<SyncResult> {
  const operations = await listPending(userId);
  let synced = 0;
  let failed = 0;
  for (const op of operations) {
    try {
      if (op.kind === 'workout_set') await transport.upsertWorkoutSet(userId, op);
      else if (op.kind === 'food_log') await (op.deleted ? transport.deleteFoodLog(userId, op) : transport.upsertFoodLog(userId, op));
      else await transport.upsertCheckin(userId, op);
      await removeIfUnchanged(userId, op);
      synced += 1;
    } catch (error) {
      // Keep it queued and carry on: one item that keeps failing must not block the rest.
      // The next trigger retries it, and server writes are idempotent.
      failed += 1;
      // A daily-limit refusal is not a fault: remember why (and when the server resets) so it can be shown.
      if (error instanceof QuotaLimitError) await markBlocked(userId, op, error.reason).catch(() => undefined);
    }
  }
  const remaining = (await listPending(userId)).length;
  return { synced, failed, remaining };
}

export function flushPending(userId: string, transport: SyncTransport): Promise<SyncResult> {
  const running = inFlight.get(userId);
  if (running) return running;
  const flush = run(userId, transport).finally(() => {
    inFlight.delete(userId);
  });
  inFlight.set(userId, flush);
  return flush;
}
