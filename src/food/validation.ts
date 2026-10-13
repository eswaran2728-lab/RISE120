import { parseDecimal } from '../onboarding/units';
import type { FoodFields, Nutrition } from './types';

const MAX_CALORIES = 10000;
const MAX_GRAMS = 1000;
const MAX_QUANTITY = 100;

export type FoodField = keyof FoodFields;
export type FoodParseResult =
  | { ok: true; value: { name: string; servingDesc: string } & Nutrition }
  | { ok: false; field: FoodField; reason: 'required' | 'invalid' | 'max' };

type NumberResult = { ok: true; value: number } | { ok: false; reason: 'required' | 'invalid' | 'max' };

// A blank field is "required", never zero: a missing nutrient must not silently become 0.
function parseNutrient(text: string, max: number): NumberResult {
  if (text.trim() === '') return { ok: false, reason: 'required' };
  const value = parseDecimal(text);
  if (value === null) return { ok: false, reason: 'invalid' };
  if (value > max) return { ok: false, reason: 'max' };
  return { ok: true, value };
}

export function parseFoodInput(input: FoodFields): FoodParseResult {
  const name = input.name.trim();
  if (name === '') return { ok: false, field: 'name', reason: 'required' };
  const servingDesc = input.servingDesc.trim();
  if (servingDesc === '') return { ok: false, field: 'servingDesc', reason: 'required' };

  const calories = parseNutrient(input.calories, MAX_CALORIES);
  if (!calories.ok) return { ok: false, field: 'calories', reason: calories.reason };
  const protein = parseNutrient(input.protein, MAX_GRAMS);
  if (!protein.ok) return { ok: false, field: 'protein', reason: protein.reason };
  const carbs = parseNutrient(input.carbs, MAX_GRAMS);
  if (!carbs.ok) return { ok: false, field: 'carbs', reason: carbs.reason };
  const fat = parseNutrient(input.fat, MAX_GRAMS);
  if (!fat.ok) return { ok: false, field: 'fat', reason: fat.reason };

  return {
    ok: true,
    value: { name, servingDesc, calories: calories.value, proteinG: protein.value, carbsG: carbs.value, fatG: fat.value },
  };
}

export type QuantityParse =
  | { ok: true; quantity: number }
  | { ok: false; reason: 'required' | 'invalid' | 'max' };

// Quantity is the number of listed servings (1.5 = a serving and a half). It must be positive.
export function parseQuantity(text: string): QuantityParse {
  if (text.trim() === '') return { ok: false, reason: 'required' };
  const quantity = parseDecimal(text);
  if (quantity === null || quantity <= 0) return { ok: false, reason: 'invalid' };
  if (quantity > MAX_QUANTITY) return { ok: false, reason: 'max' };
  return { ok: true, quantity };
}

// Energy should roughly match 4 kcal/g protein and carbs plus 9 kcal/g fat. A far-off record is
// bad data (mixed per-100 g and per-serving units, a missing macro) and must not become a log.
export function isEnergyConsistent(n: Nutrition): boolean {
  const fromMacros = 4 * n.proteinG + 4 * n.carbsG + 9 * n.fatG;
  const tolerance = Math.max(10, 0.35 * Math.max(n.calories, fromMacros));
  return Math.abs(n.calories - fromMacros) <= tolerance;
}
