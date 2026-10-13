import type { FoodLogOperation, LocalDate } from '../sync/types';
import { foodNutrition, sumNutrition } from './nutrition';
import { Food, MEAL_TYPES, MealType, Nutrition } from './types';

// A meal log as stored on the server (with its food joined).
export interface SyncedLogEntry {
  id: string;
  date: LocalDate;
  foodId: string;
  quantity: number;
  mealType: MealType;
  food: Food | null;
}

export interface FoodDayEntry {
  id: string;
  date: LocalDate;
  foodId: string;
  quantity: number;
  mealType: MealType;
  food: Food | null; // null = the food could not be found; shown as unavailable, never as zero
  nutrition: Nutrition | null;
  pending: boolean;
}

export interface MealGroup {
  entries: FoodDayEntry[];
  totals: Nutrition;
}

export interface FoodDay {
  date: LocalDate;
  entries: FoodDayEntry[];
  byMeal: Record<MealType, MealGroup>;
  totals: Nutrition;
  incomplete: boolean; // some entry's food is unknown, so totals may be low
}

const MEAL_ORDER = new Map(MEAL_TYPES.map((meal, index) => [meal, index]));

// One day's meals: server rows plus pending operations, merged by log id. A pending edit replaces
// the synced row (so totals change once, not twice); a pending delete hides it. Only entries for the
// requested local date count, however late they sync.
export function buildFoodDay(input: {
  date: LocalDate;
  synced: SyncedLogEntry[];
  pending: FoodLogOperation[];
  knownFoods: Food[];
}): FoodDay {
  const known = new Map(input.knownFoods.map((food) => [food.id, food]));
  const entries = new Map<string, FoodDayEntry>();

  const toEntry = (base: Omit<FoodDayEntry, 'food' | 'nutrition' | 'pending'> & { food: Food | null }, pending: boolean): FoodDayEntry => {
    const food = base.food ?? known.get(base.foodId) ?? null;
    return { ...base, food, nutrition: food ? foodNutrition(food, base.quantity) : null, pending };
  };

  for (const row of input.synced) {
    if (row.date === input.date) entries.set(row.id, toEntry(row, false));
  }
  for (const op of input.pending) {
    if (op.date !== input.date) continue;
    if (op.deleted) {
      entries.delete(op.id);
      continue;
    }
    entries.set(op.id, toEntry(op, true));
  }

  const ordered = [...entries.values()].sort((a, b) => (MEAL_ORDER.get(a.mealType) ?? 0) - (MEAL_ORDER.get(b.mealType) ?? 0));
  const group = (meal: MealType): MealGroup => {
    const mealEntries = ordered.filter((entry) => entry.mealType === meal);
    return { entries: mealEntries, totals: sumNutrition(mealEntries.flatMap((entry) => (entry.nutrition ? [entry.nutrition] : []))) };
  };

  return {
    date: input.date,
    entries: ordered,
    byMeal: { breakfast: group('breakfast'), lunch: group('lunch'), dinner: group('dinner'), snack: group('snack') },
    totals: sumNutrition(ordered.flatMap((entry) => (entry.nutrition ? [entry.nutrition] : []))),
    incomplete: ordered.some((entry) => entry.food === null),
  };
}
