// Favourite foods, kept on this phone for this account only, so they are there at restart and with no signal. A
// favourite holds a snapshot of the food as it was saved, including its source, source id and verified label, so an
// old favourite stays identifiable if the catalogue later changes the food; the app can compare it with the current
// food and say so. Open Food Facts products are a read-only preview and are never stored. Cleared with the account.
import { readCache, writeCache } from '../cache/userCache';
import type { Food } from './types';

export interface Favourite {
  food: Food;
  savedAt: number; // when this version of the food was saved
  lastServings: number; // where the next log starts; always editable before saving
}

const MAX_FAVOURITES = 100;
const MAX_SERVINGS = 100;

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function validFavourite(value: unknown): value is Favourite {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const f = v.food as Record<string, unknown> | null;
  return (
    !!f && typeof f === 'object' &&
    typeof f.id === 'string' && typeof f.name === 'string' && typeof f.servingDesc === 'string' && typeof f.source === 'string' &&
    isNumber(f.calories) && isNumber(f.proteinG) && isNumber(f.carbsG) && isNumber(f.fatG) &&
    isNumber(v.savedAt) && isNumber(v.lastServings) && v.lastServings > 0
  );
}

export async function loadFavourites(userId: string): Promise<Favourite[]> {
  const stored = await readCache<unknown>(userId, 'favourites');
  return Array.isArray(stored) ? stored.filter(validFavourite) : [];
}

const save = (userId: string, list: Favourite[]) => writeCache(userId, 'favourites', list.slice(0, MAX_FAVOURITES));

export async function isFavourite(userId: string, foodId: string): Promise<boolean> {
  return (await loadFavourites(userId)).some((f) => f.food.id === foodId);
}

// Adds the food (newest first) or removes it. Returns whether it is a favourite now. Open Food Facts products are not kept.
export async function toggleFavourite(userId: string, food: Food): Promise<boolean> {
  const list = await loadFavourites(userId);
  if (list.some((f) => f.food.id === food.id)) {
    await save(userId, list.filter((f) => f.food.id !== food.id));
    return false;
  }
  if (food.source === 'openfoodfacts') return false;
  await save(userId, [{ food, savedAt: Date.now(), lastServings: 1 }, ...list]);
  return true;
}

export async function removeFavourite(userId: string, foodId: string): Promise<void> {
  const list = await loadFavourites(userId);
  if (list.some((f) => f.food.id === foodId)) await save(userId, list.filter((f) => f.food.id !== foodId));
}

// Remembers the servings last used for a favourite. A value that makes no sense is ignored.
export async function rememberServings(userId: string, foodId: string, servings: number): Promise<void> {
  if (!isNumber(servings) || servings <= 0 || servings > MAX_SERVINGS) return;
  const list = await loadFavourites(userId);
  if (!list.some((f) => f.food.id === foodId)) return;
  await save(userId, list.map((f) => (f.food.id === foodId ? { ...f, lastServings: servings } : f)));
}

// Does the catalogue still hold what was saved? 'changed' when its values, serving, verified label or source version
// differ; 'unavailable' when the food can no longer be read.
export function compareToCurrent(favourite: Favourite, current: Food | null): 'same' | 'changed' | 'unavailable' {
  if (!current) return 'unavailable';
  const a = favourite.food;
  const same =
    a.calories === current.calories && a.proteinG === current.proteinG && a.carbsG === current.carbsG && a.fatG === current.fatG &&
    a.servingDesc === current.servingDesc && a.verified === current.verified && a.source === current.source && a.sourceId === current.sourceId;
  return same ? 'same' : 'changed';
}
