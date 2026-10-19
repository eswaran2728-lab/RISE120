// Logging a planned meal. Choosing a recipe in the planner never logs anything: the member confirms, and only then is
// the meal logged through the existing food-log queue with a stable id, so a double tap, a retry after a restart or a
// replay all address one log. A recipe is logged as a private food (source 'recipe', unverified) that carries its
// per-serving values; a recipe with any unknown core value cannot be logged, because a log needs real numbers and a
// missing one must never become zero.
import { supabase } from '../../lib/supabase';
import { stableUuid } from '../../lib/stableId';
import type { LocalDate } from '../../sync/types';
import { recentFoods, rememberFoods } from '../cache';
import { queueFoodLog } from '../log';
import { FOOD_COLUMNS, mapFoodRow } from '../map';
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

export type PlannedLogResult = { kind: 'logged'; logId: string } | { kind: 'not_confirmed' } | { kind: 'nutrition_unknown' } | { kind: 'offline' };

const sourceIdOf = (recipe: Recipe) => `${recipe.id}@${recipe.version}`;

// The member's private food for this recipe version: remembered on this phone first (so logging works offline once it
// exists), otherwise read or created on the server. Null when the server cannot be reached.
async function recipeFood(userId: string, recipe: Recipe): Promise<Food | null> {
  const sourceId = sourceIdOf(recipe);
  const remembered = (await recentFoods(userId)).find((f) => f.source === 'recipe' && f.sourceId === sourceId);
  if (remembered) return remembered;

  const n = recipe.nutrition!.perServing;
  try {
    const found = await supabase.from('foods').select(FOOD_COLUMNS).eq('user_id', userId).eq('source', 'recipe').eq('source_id', sourceId).maybeSingle();
    if (found.error) return null;
    if (found.data) return mapFoodRow(found.data);
    const created = await supabase
      .from('foods')
      .insert({
        user_id: userId,
        name: recipe.name.en,
        aliases: recipe.status === 'published' ? { ms: [recipe.name.ms], ta: [recipe.name.ta] } : {},
        serving_desc: `1 serving of ${recipe.name.en}`,
        calories: n.calories,
        protein_g: n.proteinG,
        carbs_g: n.carbsG,
        fat_g: n.fatG,
        source: 'recipe',
        source_id: sourceId,
        verified: false,
        region: recipe.region,
      })
      .select(FOOD_COLUMNS)
      .single();
    return created.error || !created.data ? null : mapFoodRow(created.data);
  } catch {
    return null;
  }
}

export async function logPlannedMeal(
  userId: string,
  date: LocalDate,
  input: { recipe: Recipe; servings: number; mealType: MealType; slotKey: string; confirmed: boolean }
): Promise<PlannedLogResult> {
  if (!input.confirmed) return { kind: 'not_confirmed' };
  const n = input.recipe.nutrition?.perServing;
  if (!n || n.calories === null || n.proteinG === null || n.carbsG === null || n.fatG === null) return { kind: 'nutrition_unknown' };

  const food = await recipeFood(userId, input.recipe);
  if (!food) return { kind: 'offline' };
  await rememberFoods(userId, [food]);
  const logId = plannedMealLogId(userId, { date, recipeId: input.recipe.id, mealType: input.mealType, slotKey: input.slotKey });
  await queueFoodLog(userId, date, { id: logId, food, quantity: input.servings, mealType: input.mealType });
  return { kind: 'logged', logId };
}
