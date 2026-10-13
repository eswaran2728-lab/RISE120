import { supabase } from '../lib/supabase';
import { rememberFoods } from './cache';
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

export async function updateCustomFood(userId: string, foodId: string, input: FoodFields): Promise<Food> {
  const value = parseOrThrow(input);
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

// A food that meal logs reference cannot be deleted: that would erase those meals from history.
// The database enforces the same rule, so a log added meanwhile is also refused.
export async function deleteCustomFood(userId: string, foodId: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from('food_logs')
    .select('id', { count: 'exact', head: true })
    .eq('food_id', foodId);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) > 0) throw new CustomFoodError('in_use');

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
