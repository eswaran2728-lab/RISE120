import type { FoodDay } from './day';
import { remainingNutrition } from './nutrition';
import type { Food, MealType, Nutrition, TargetsLike } from './types';

export interface FoodDaySummary {
  consumed: Nutrition;
  remaining: TargetsLike; // null = no target; negative = over the target
  overCalories: boolean;
  overProtein: boolean;
  incomplete: boolean;
}

// What the Food tab shows for a day: consumed calories and macros, and remaining calories and
// protein against the plan day's targets. Carbs and fat have no targets, so only consumption shows.
export function foodDaySummary(day: FoodDay, targets: TargetsLike): FoodDaySummary {
  const remaining = remainingNutrition(targets, day.totals);
  return {
    consumed: day.totals,
    remaining,
    overCalories: remaining.calories !== null && remaining.calories < 0,
    overProtein: remaining.proteinG !== null && remaining.proteinG < 0,
    incomplete: day.incomplete,
  };
}

const SOURCE_KEYS: Record<string, string> = {
  curated: 'food.sources.curated',
  usda: 'food.sources.usda',
  openfoodfacts: 'food.sources.openfoodfacts',
  custom: 'food.sources.custom',
};

// The label shown next to a food. Only a food actually flagged verified is shown as verified.
export function foodSourceLabel(food: Food): { key: string; verified: boolean } {
  return { key: SOURCE_KEYS[food.source] ?? 'food.sources.unknown', verified: food.verified };
}

// "1.5 × 100 g": the number of listed servings and the serving size, so nothing is ambiguous.
export function formatServing(quantity: number, servingDesc: string): string {
  return `${quantity} × ${servingDesc}`;
}

// A sensible starting meal for the time of day; the user can change it.
export function defaultMealFor(now: Date): MealType {
  const hour = now.getHours();
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 18 && hour < 22) return 'dinner';
  return 'snack';
}
