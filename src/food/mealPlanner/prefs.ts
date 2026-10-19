// The member's meal planning choices, kept on this phone for this account only. No cooker, no diet and no budget are
// assumed: the planner starts with the cautious reading and the member opens it up. A damaged stored value means the
// defaults, and a value that makes no sense is never saved.
import { readCache, writeCache } from '../../cache/userCache';
import { COOKING, DIET_LABELS, FREE_FROM } from '../recipes';
import type { MealType } from '../types';
import type { Preferences } from './select';

export const DEFAULT_PREFS: Preferences = { cooking: [], maxMinutes: null, diets: [], avoid: [], budget: null, mealsPerDay: 3, days: 1 };

const isStringList = (v: unknown, allowed: readonly string[]) => Array.isArray(v) && v.every((x) => typeof x === 'string' && allowed.includes(x));

function valid(v: unknown): v is Preferences {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  const budget = p.budget as Record<string, unknown> | null;
  return (
    isStringList(p.cooking, COOKING) &&
    isStringList(p.diets, DIET_LABELS) &&
    isStringList(p.avoid, FREE_FROM) &&
    (p.maxMinutes === null || (typeof p.maxMinutes === 'number' && Number.isFinite(p.maxMinutes) && p.maxMinutes > 0 && p.maxMinutes <= 600)) &&
    typeof p.mealsPerDay === 'number' && Number.isInteger(p.mealsPerDay) && p.mealsPerDay >= 1 && p.mealsPerDay <= 6 &&
    typeof p.days === 'number' && Number.isInteger(p.days) && p.days >= 1 && p.days <= 7 &&
    (budget === null ||
      (typeof budget === 'object' && typeof budget.amount === 'number' && Number.isFinite(budget.amount) && budget.amount >= 0 && typeof budget.currency === 'string' && /^[A-Z]{3}$/.test(budget.currency) && budget.per === 'day'))
  );
}

export async function loadMealPrefs(userId: string): Promise<Preferences> {
  const stored = await readCache<unknown>(userId, 'mealPrefs');
  return valid(stored) ? stored : { ...DEFAULT_PREFS };
}

export async function saveMealPrefs(userId: string, prefs: Preferences): Promise<boolean> {
  if (!valid(prefs)) return false;
  await writeCache(userId, 'mealPrefs', prefs);
  return true;
}

// Which meal a slot of the day is, for logging.
export function mealTypeForSlot(slot: number, mealsPerDay: number): MealType {
  if (mealsPerDay === 1) return 'lunch';
  if (mealsPerDay === 2) return slot === 0 ? 'breakfast' : 'dinner';
  return (['breakfast', 'lunch', 'dinner', 'snack', 'snack', 'snack'] as MealType[])[slot] ?? 'snack';
}
