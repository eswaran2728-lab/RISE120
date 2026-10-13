import { supabase } from '../lib/supabase';
import { listPending } from '../sync/queue';
import { forgetFood, rememberFoods } from './cache';
import { FOOD_COLUMNS, mapFoodRow } from './map';
import type { Food, FoodFields } from './types';
import { FoodField, parseFoodInput } from './validation';

export type CustomFoodErrorCode = 'invalid' | 'not_found' | 'in_use';

export class CustomFoodError extends Error {
  constructor(
    public readonly code: CustomFoodErrorCode,
    public readonly field?: FoodField,
    public readonly reason?: 'required' | 'invalid' | 'max'
  ) {
    super(code);
    this.name = 'CustomFoodError';
  }
}

// Only the validated form fields are ever sent. The owner, source, verified flag and region are
// set here (and enforced by row-level security), never taken from the input.
function parseOrThrow(input: FoodFields) {
  const parsed = parseFoodInput(input);
  if (!parsed.ok) throw new CustomFoodError('invalid', parsed.field, parsed.reason);
  return parsed.value;
}

export async function createCustomFood(userId: string, input: FoodFields): Promise<Food> {
  const value = parseOrThrow(input);
  const { data, error } = await supabase
    .from('foods')
    .insert({
      user_id: userId,
      name: value.name,
      serving_desc: value.servingDesc,
      calories: value.calories,
      protein_g: value.proteinG,
      carbs_g: value.carbsG,
      fat_g: value.fatG,
      source: 'custom',
      verified: false,
      region: null,
    })
    .select(FOOD_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  const food = mapFoodRow(data);
  await rememberFoods(userId, [food]);
  return food;
}

// Past and queued meals point at a food by id, so a food that any meal references is frozen: editing
// it would rewrite earlier days' totals and deleting it would erase those meals or strand a queued
// one. The user can add a new food instead.
async function assertNotLogged(userId: string, foodId: string): Promise<void> {
  const { count, error } = await supabase.from('food_logs').select('id', { count: 'exact', head: true }).eq('food_id', foodId);
  if (error) throw new Error(error.message);
  if ((count ?? 0) > 0) throw new CustomFoodError('in_use');
  const queued = (await listPending(userId)).some((op) => op.kind === 'food_log' && op.foodId === foodId && !op.deleted);
  if (queued) throw new CustomFoodError('in_use');
}

export async function updateCustomFood(userId: string, foodId: string, input: FoodFields): Promise<Food> {
  const value = parseOrThrow(input);
  await assertNotLogged(userId, foodId);
  const { data, error } = await supabase
    .from('foods')
    .update({
      name: value.name,
      serving_desc: value.servingDesc,
      calories: value.calories,
      protein_g: value.proteinG,
      carbs_g: value.carbsG,
      fat_g: value.fatG,
    })
    .eq('id', foodId)
    .eq('user_id', userId)
    .eq('source', 'custom')
    .eq('verified', false)
    .select(FOOD_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new CustomFoodError('not_found');
  const food = mapFoodRow(data);
  await rememberFoods(userId, [food]);
  return food;
}

// A food that meal logs reference cannot be deleted. The database enforces the same rule for synced
// logs, so a log added meanwhile is also refused.
export async function deleteCustomFood(userId: string, foodId: string): Promise<void> {
  await assertNotLogged(userId, foodId);

  const { data, error } = await supabase
    .from('foods')
    .delete()
    .eq('id', foodId)
    .eq('user_id', userId)
    .eq('source', 'custom')
    .eq('verified', false)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new CustomFoodError('in_use');
  // It no longer exists, so offline search must stop offering it.
  await forgetFood(userId, foodId);
}

export async function getOwnCustomFood(userId: string, foodId: string): Promise<Food | null> {
  const { data, error } = await supabase
    .from('foods')
    .select(FOOD_COLUMNS)
    .eq('id', foodId)
    .eq('user_id', userId)
    .eq('source', 'custom')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapFoodRow(data) : null;
}
