import { readCache, writeCache } from '../cache/userCache';
import type { Food } from './types';

const MAX_RECENT = 50;

// The foods this account actually logged or chose, newest first. They let the user search and log
// offline, and keep each food's source and verified label. Cleared with the account cache.
export async function recentFoods(userId: string): Promise<Food[]> {
  const stored = await readCache<Food[]>(userId, 'recentFoods');
  return Array.isArray(stored) ? stored : [];
}

// Drops one food from the recent list (for example after the user deletes their own food).
export async function forgetFood(userId: string, foodId: string): Promise<void> {
  const current = await recentFoods(userId);
  if (current.some((food) => food.id === foodId)) {
    await writeCache(userId, 'recentFoods', current.filter((food) => food.id !== foodId));
  }
}

export async function rememberFoods(userId: string, foods: Food[]): Promise<void> {
  const current = await recentFoods(userId);
  const ids = new Set(foods.map((food) => food.id));
  const merged = [...foods, ...current.filter((food) => !ids.has(food.id))].slice(0, MAX_RECENT);
  await writeCache(userId, 'recentFoods', merged);
}
