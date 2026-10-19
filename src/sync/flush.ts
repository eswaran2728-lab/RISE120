import { QuotaLimitError } from '../monetization/errors';
import { replaceFoodId } from '../food/cache';
import { listPending, markBlocked, remapFoodId, removeIfUnchanged } from './queue';
import type { PendingOperation, SyncResult, SyncTransport } from './types';

// One flush per account at a time; concurrent callers share the running flush.
const inFlight = new Map<string, Promise<SyncResult>>();

async function run(userId: string, transport: SyncTransport): Promise<SyncResult> {
  // A recipe's food is created before any log that uses it, whatever order they were queued in.
  const queued = await listPending(userId);
  const operations: PendingOperation[] = [...queued.filter((op) => op.kind === 'recipe_food'), ...queued.filter((op) => op.kind !== 'recipe_food')];
  const unsyncedFoods = new Set<string>();
  let synced = 0;
  let failed = 0;
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    // A log whose food could not be created yet waits; sending it now could only be refused.
    if (op.kind === 'food_log' && !op.deleted && unsyncedFoods.has(op.foodId)) {
      failed += 1;
      continue;
    }
    try {
      if (op.kind === 'workout_set') await transport.upsertWorkoutSet(userId, op);
      else if (op.kind === 'food_log') await (op.deleted ? transport.deleteFoodLog(userId, op) : transport.upsertFoodLog(userId, op));
      else if (op.kind === 'recipe_food') {
        const serverId = await transport.upsertRecipeFood(userId, op);
        if (serverId !== op.id) {
          // The server already had this member's food for the recipe version under another id.
          await remapFoodId(userId, op.id, serverId);
          await replaceFoodId(userId, op.id, serverId).catch(() => undefined);
          for (let j = i + 1; j < operations.length; j++) {
            const later = operations[j];
            if (later.kind === 'food_log' && later.foodId === op.id) operations[j] = { ...later, foodId: serverId, food: later.food ? { ...later.food, id: serverId } : later.food };
          }
        }
      } else await transport.upsertCheckin(userId, op);
      await removeIfUnchanged(userId, op);
      synced += 1;
    } catch (error) {
      // Keep it queued and carry on: one item that keeps failing must not block the rest.
      // The next trigger retries it, and server writes are idempotent.
      failed += 1;
      if (op.kind === 'recipe_food') unsyncedFoods.add(op.id);
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
