// The reviewed eating-out dishes a member can see, as the app reads them: published only (the database decides), with
// the same rules applied again to what is read and what is remembered, newest version of each, kept on this phone per
// account for offline use. With nothing read the answer is an empty list, never an error.
import { readCache, writeCache } from '../cache/userCache';
import { supabase } from '../lib/supabase';
import { Dish, mapDishRow, validateDishes } from './eatingOut';

const COLUMNS = 'id, version, status, region, name, aliases, tips, calories_min, calories_max, serving_note, provenance, reviewer';

function visible(rows: unknown[]): Dish[] {
  const newest = new Map<string, Dish>();
  for (const raw of rows) {
    const dish = mapDishRow(raw);
    if (!dish || dish.status !== 'published' || validateDishes([dish]).length > 0) continue;
    const seen = newest.get(dish.id);
    if (!seen || dish.version > seen.version) newest.set(dish.id, dish);
  }
  return [...newest.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

export async function loadDishes(userId: string): Promise<Dish[]> {
  try {
    const { data, error } = await supabase.from('eating_out_dishes').select(COLUMNS);
    if (!error && Array.isArray(data)) {
      await writeCache(userId, 'eatingOut', data);
      return visible(data);
    }
  } catch {
    // Offline: fall back to what was read last.
  }
  const cached = await readCache<unknown[]>(userId, 'eatingOut');
  return Array.isArray(cached) ? visible(cached) : [];
}
