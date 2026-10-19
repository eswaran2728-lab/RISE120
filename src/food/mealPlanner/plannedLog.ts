// Logging a planned meal. Choosing a recipe in the planner never logs anything: the member confirms, and only then is
// the meal logged through the existing food-log queue with a stable id, so a double tap, a retry after a restart or a
// replay all address one log. A recipe is logged as a private food (source 'recipe', unverified) that carries its
// per-serving values; a recipe with any unknown core value cannot be logged, because a log needs real numbers and a
// missing one must never become zero.
//
// Nothing here needs a connection. The first time a recipe version is logged on this phone, creating its private food
// is queued (under a stable id) ahead of the log, and both sync when the phone is back online, food first.
import { stableUuid } from '../../lib/stableId';
import { enqueue } from '../../sync/queue';
import type { LocalDate } from '../../sync/types';
import { recentFoods } from '../cache';
import { queueFoodLog } from '../log';
import type { Food, MealType } from '../types';
import type { Recipe } from '../recipes';

export interface PlannedMealRef {
  date: LocalDate;
  recipeId: string;
  mealType: MealType;
  slotKey: string; // the day and slot of the plan, so identical recipes in two slots are two logs
}

// One id per account, day, meal, recipe and slot.
export function plannedMealLogId(userId: string, ref: PlannedMealRef): string {
  return stableUuid(`${userId}|planned|${ref.date}|${ref.mealType}|${ref.recipeId}|${ref.slotKey}`);
}

export type PlannedLogResult = { kind: 'logged'; logId: string } | { kind: 'not_confirmed' } | { kind: 'nutrition_unknown' };

const sourceIdOf = (recipe: Recipe) => `${recipe.id}@${recipe.version}`;

// One food id per account and recipe version, so a retry or a lost response addresses the same food.
export function recipeFoodId(userId: string, recipe: Recipe): string {
  return stableUuid(`${userId}|recipe-food|${sourceIdOf(recipe)}`);
}

// The member's private, unverified food for this recipe version, carrying the recipe's source and version.
function recipeFoodSnapshot(userId: string, recipe: Recipe, n: { calories: number; proteinG: number; carbsG: number; fatG: number }): Food {
  return {
    id: recipeFoodId(userId, recipe),
    userId,
    name: recipe.name.en,
    aliases: recipe.status === 'published' ? { ms: [recipe.name.ms], ta: [recipe.name.ta] } : {},
    servingDesc: `1 serving of ${recipe.name.en}`,
    calories: n.calories,
    proteinG: n.proteinG,
    carbsG: n.carbsG,
    fatG: n.fatG,
    source: 'recipe',
    verified: false,
    region: recipe.region,
    sourceId: sourceIdOf(recipe),
    barcode: null,
  };
}

export async function logPlannedMeal(
  userId: string,
  date: LocalDate,
  input: { recipe: Recipe; servings: number; mealType: MealType; slotKey: string; confirmed: boolean }
): Promise<PlannedLogResult> {
  if (!input.confirmed) return { kind: 'not_confirmed' };
  const n = input.recipe.nutrition?.perServing;
  if (!n || n.calories === null || n.proteinG === null || n.carbsG === null || n.fatG === null) return { kind: 'nutrition_unknown' };

  const sourceId = sourceIdOf(input.recipe);
  let food = (await recentFoods(userId)).find((f) => f.source === 'recipe' && f.sourceId === sourceId);
  if (!food) {
    // Never logged on this phone: queue its creation first, so it syncs before the log that refers to it.
    food = recipeFoodSnapshot(userId, input.recipe, { calories: n.calories, proteinG: n.proteinG, carbsG: n.carbsG, fatG: n.fatG });
    await enqueue(userId, { kind: 'recipe_food', id: food.id, food, updatedAt: Date.now() });
  }
  const logId = plannedMealLogId(userId, { date, recipeId: input.recipe.id, mealType: input.mealType, slotKey: input.slotKey });
  await queueFoodLog(userId, date, { id: logId, food, quantity: input.servings, mealType: input.mealType });
  return { kind: 'logged', logId };
}
