import { readCache, writeCache } from '../cache/userCache';
import { supabase } from '../lib/supabase';
import { listPending } from '../sync/queue';
import type { LocalDate } from '../sync/types';
import { recentFoods } from './cache';
import { buildFoodDay, FoodDay, SyncedLogEntry } from './day';
import { FOOD_COLUMNS, mapFoodRow } from './map';

interface FoodDayCache {
  date: LocalDate;
  entries: SyncedLogEntry[];
}

function mapLogRow(row: Record<string, any>): SyncedLogEntry {
  const joined = Array.isArray(row.foods) ? row.foods[0] : row.foods;
  return {
    id: row.id,
    date: row.log_date,
    foodId: row.food_id,
    quantity: Number(row.quantity),
    mealType: row.meal_type,
    food: joined ? mapFoodRow(joined) : null,
  };
}

// One local day of meals: the server's rows plus pending operations. If the server cannot be read,
// the last synced rows for that same day stand in, so the day still shows and can be edited offline.
export async function loadFoodDay(userId: string, date: LocalDate): Promise<FoodDay> {
  // Read the pending operations first. If a background sync finishes while the server is being read,
  // a meal can be missing from the server answer (read before the write) and already gone from the
  // queue (removed after it); taking the queue first means such a meal is still shown, once.
  const pending = (await listPending(userId)).flatMap((op) => (op.kind === 'food_log' ? [op] : []));

  let synced: SyncedLogEntry[];
  try {
    const { data, error } = await supabase
      .from('food_logs')
      .select(`id, log_date, food_id, quantity, meal_type, foods(${FOOD_COLUMNS})`)
      .eq('user_id', userId)
      .eq('log_date', date)
      .order('created_at');
    if (error) throw new Error(error.message);
    synced = (data ?? []).map(mapLogRow);
    await writeCache(userId, 'foodDay', { date, entries: synced } satisfies FoodDayCache);
  } catch {
    const cached = await readCache<FoodDayCache>(userId, 'foodDay');
    synced = cached && cached.date === date ? cached.entries : [];
  }

  const knownFoods = [...(await recentFoods(userId)), ...synced.flatMap((row) => (row.food ? [row.food] : []))];
  return buildFoodDay({ date, synced, pending, knownFoods });
}
