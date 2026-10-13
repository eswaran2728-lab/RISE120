import { readCache, writeCache } from '../cache/userCache';
import type { FoodLogOperation } from '../sync/types';
import type { SyncedLogEntry } from './day';

interface FoodDayCache {
  date: string;
  entries: SyncedLogEntry[];
}

// When a queued meal change reaches the server, record it in the cached day too. Otherwise a
// background sync removes the pending operation while the cache still holds the old row, and an
// app restart with no signal would show the old quantity or a meal that was deleted.
export async function applyFoodLogToDayCache(userId: string, op: FoodLogOperation): Promise<void> {
  const cache = await readCache<FoodDayCache>(userId, 'foodDay');
  if (!cache || cache.date !== op.date) return;

  const others = cache.entries.filter((entry) => entry.id !== op.id);
  const entries = op.deleted
    ? others
    : [...others, { id: op.id, date: op.date, foodId: op.foodId, quantity: op.quantity, mealType: op.mealType, food: op.food }];
  await writeCache(userId, 'foodDay', { date: cache.date, entries } satisfies FoodDayCache);
}
