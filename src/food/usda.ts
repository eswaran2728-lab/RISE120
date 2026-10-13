import { supabase } from '../lib/supabase';
import { rememberFoods } from './cache';
import { FOOD_COLUMNS, mapFoodRow } from './map';
import type { Food } from './types';
import { isEnergyConsistent } from './validation';

// A search result from the server's USDA lookup. Always unverified; never logged directly.
export interface UsdaPreview {
  source: 'usda';
  sourceId: string;
  name: string;
  servingDesc: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  verified: false;
  brand?: string;
}

export type UsdaErrorCode = 'rate_limited' | 'not_configured' | 'unavailable';

export class UsdaSearchError extends Error {
  constructor(public readonly code: UsdaErrorCode) {
    super(code);
    this.name = 'UsdaSearchError';
  }
}

export interface UsdaSearchResult {
  foods: UsdaPreview[];
  hasMore: boolean;
  skipped: number;
}

function errorCode(error: { context?: { status?: number } }): UsdaErrorCode {
  const status = error.context?.status;
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'not_configured';
  return 'unavailable';
}

export async function searchUsda(query: string, page: number): Promise<UsdaSearchResult> {
  const { data, error } = await supabase.functions.invoke('search-foods', { method: 'POST', body: { query, page } });
  if (error) throw new UsdaSearchError(errorCode(error as { context?: { status?: number } }));
  if (!data || !Array.isArray(data.foods)) throw new UsdaSearchError('unavailable');
  return { foods: data.foods as UsdaPreview[], hasMore: Boolean(data.hasMore), skipped: Number(data.skipped) || 0 };
}

const isNutrient = (value: number) => Number.isFinite(value) && value >= 0;

async function findExisting(userId: string, sourceId: string): Promise<Food | null> {
  const { data, error } = await supabase
    .from('foods')
    .select(FOOD_COLUMNS)
    .eq('user_id', userId)
    .eq('source', 'usda')
    .eq('source_id', sourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapFoodRow(data) : null;
}

// A chosen USDA result becomes the user's own unverified food, keyed by its FDC id, so repeated
// choices reuse one row and it can be logged and used offline. Incomplete data is refused here too.
export async function saveUsdaFood(userId: string, preview: UsdaPreview): Promise<Food> {
  const nutrients = [preview.calories, preview.proteinG, preview.carbsG, preview.fatG];
  if (preview.name.trim() === '' || preview.servingDesc.trim() === '' || !nutrients.every(isNutrient) || !isEnergyConsistent(preview)) {
    throw new Error('Incomplete or inconsistent nutrition data');
  }

  let food = await findExisting(userId, preview.sourceId);
  if (!food) {
    const { data, error } = await supabase
      .from('foods')
      .insert({
        user_id: userId,
        name: preview.name.trim(),
        serving_desc: preview.servingDesc.trim(),
        calories: preview.calories,
        protein_g: preview.proteinG,
        carbs_g: preview.carbsG,
        fat_g: preview.fatG,
        source: 'usda',
        source_id: preview.sourceId,
        source_url: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${preview.sourceId}/nutrients`,
        verified: false,
        region: null,
      })
      .select(FOOD_COLUMNS)
      .single();
    if (error) {
      // Lost a race with another save of the same food: use the winner.
      if (error.code === '23505') food = await findExisting(userId, preview.sourceId);
      if (!food) throw new Error(error.message);
    } else {
      food = mapFoodRow(data);
    }
  }
  await rememberFoods(userId, [food]);
  return food;
}
