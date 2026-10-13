// Normalizes USDA FoodData Central search results into unverified food previews. Pure, no I/O.
// A record with missing, non-numeric, negative or mixed-unit nutrition, or energy that does not
// match its macros, is skipped rather than turned into a zero-valued food.
import { isEnergyConsistent } from './consistency.ts';

export interface UsdaPreview {
  source: 'usda';
  sourceId: string; // FoodData Central id
  name: string;
  servingDesc: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  verified: false;
  brand?: string;
}

export interface UsdaSearchResult {
  foods: UsdaPreview[];
  skipped: number;
  hasMore: boolean;
}

// Energy: plain energy first, then the Atwater general and specific factors.
const ENERGY_IDS = [1008, 2047, 2048];
const PROTEIN_ID = 1003;
const CARBS_ID = 1005;
const FAT_ID = 1004;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const round2 = (n: number) => Math.round(n * 100) / 100;

// First matching nutrient whose unit is as expected and whose value is a non-negative number.
function nutrientValue(nutrients: unknown[], ids: number[], unit: string): number | null {
  for (const id of ids) {
    for (const entry of nutrients) {
      if (!isObject(entry) || entry.nutrientId !== id) continue;
      if (typeof entry.unitName !== 'string' || entry.unitName.toUpperCase() !== unit) continue;
      if (typeof entry.value === 'number' && Number.isFinite(entry.value) && entry.value >= 0) return entry.value;
    }
  }
  return null;
}

function parseFood(raw: unknown): UsdaPreview | null {
  if (!isObject(raw)) return null;
  const id = typeof raw.fdcId === 'number' && Number.isFinite(raw.fdcId) ? String(raw.fdcId) : null;
  const name = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (!id || name === '') return null;

  const nutrients = Array.isArray(raw.foodNutrients) ? raw.foodNutrients : [];
  const calories = nutrientValue(nutrients, ENERGY_IDS, 'KCAL');
  const protein = nutrientValue(nutrients, [PROTEIN_ID], 'G');
  const carbs = nutrientValue(nutrients, [CARBS_ID], 'G');
  const fat = nutrientValue(nutrients, [FAT_ID], 'G');
  if (calories === null || protein === null || carbs === null || fat === null) return null;

  // Values are per 100 g. A branded food is scaled to its serving only when the serving is in grams;
  // any other unit is skipped because the basis could not be stated honestly.
  let factor = 1;
  let servingDesc = '100 g';
  if (raw.dataType === 'Branded') {
    const unit = typeof raw.servingSizeUnit === 'string' ? raw.servingSizeUnit.toLowerCase() : '';
    const size = raw.servingSize;
    if ((unit !== 'g' && unit !== 'grm') || typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return null;
    factor = size / 100;
    const household = typeof raw.householdServingFullText === 'string' ? raw.householdServingFullText.trim() : '';
    servingDesc = household === '' ? `${size} g` : `${household} (${size} g)`;
  }

  const food: UsdaPreview = {
    source: 'usda',
    sourceId: id,
    name,
    servingDesc,
    calories: round2(calories * factor),
    proteinG: round2(protein * factor),
    carbsG: round2(carbs * factor),
    fatG: round2(fat * factor),
    verified: false,
  };
  if (!isEnergyConsistent(food)) return null;
  if (typeof raw.brandOwner === 'string' && raw.brandOwner.trim() !== '') food.brand = raw.brandOwner.trim();
  return food;
}

export function parseUsdaSearch(body: unknown): UsdaSearchResult {
  if (!isObject(body) || !Array.isArray(body.foods)) return { foods: [], skipped: 0, hasMore: false };

  const foods: UsdaPreview[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of body.foods) {
    const food = parseFood(raw);
    if (!food || seen.has(food.sourceId)) {
      skipped += 1;
      continue;
    }
    seen.add(food.sourceId);
    foods.push(food);
  }
  const hasMore = typeof body.currentPage === 'number' && typeof body.totalPages === 'number' && body.currentPage < body.totalPages;
  return { foods, skipped, hasMore };
}
