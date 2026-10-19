// Portion arithmetic that never confuses grams, servings and per-100 g values. A nutrition value is always tagged with
// its basis ('per_serving' or 'per_100g') and the functions refuse the wrong one. An unknown nutrient (null) stays
// unknown through every calculation: it never turns into 0, because 0 would claim "none".
export type Unit = 'g' | 'kg' | 'ml' | 'l' | 'tsp' | 'tbsp' | 'cup' | 'piece';
export const UNITS: readonly Unit[] = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'piece'];

export interface Quantity {
  amount: number;
  unit: Unit;
}

interface Values {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fibreG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
}
export type PerServing = Values & { basis: 'per_serving' };
export type Per100g = Values & { basis: 'per_100g' };

export const MAX_SERVINGS = 50;
const KEYS = ['calories', 'proteinG', 'carbsG', 'fatG', 'fibreG', 'sugarG', 'sodiumMg'] as const;

// Two decimals removes float noise (0.1 * 3) without losing real precision. The epsilon keeps 1.005 at 1.01.
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// How much of a recipe is wanted, as a multiple of its yield. Fractional portions are allowed.
export function scaleServingsFactor(recipeYield: number, wantedServings: number): number {
  if (!Number.isFinite(recipeYield) || recipeYield <= 0) throw new Error('Recipe yield must be a positive number of servings');
  if (!Number.isFinite(wantedServings) || wantedServings <= 0 || wantedServings > MAX_SERVINGS) throw new Error(`Servings must be more than 0 and at most ${MAX_SERVINGS}`);
  return wantedServings / recipeYield;
}

export const scaleAmount = (amount: number, factor: number): number => round2(amount * factor);

const mapValues = (values: Values, fn: (n: number) => number | null): Omit<Values, never> => {
  const out = {} as Record<(typeof KEYS)[number], number | null>;
  for (const key of KEYS) out[key] = values[key] === null || values[key] === undefined ? null : fn(values[key] as number);
  return out;
};

// Per-serving values times a number of servings. Unknown stays unknown.
export function servingNutrition(values: PerServing, servings: number): PerServing {
  if (values.basis !== 'per_serving') throw new Error('Expected values per serving');
  if (!Number.isFinite(servings) || servings <= 0 || servings > MAX_SERVINGS) throw new Error('Invalid servings');
  return { basis: 'per_serving', ...mapValues(values, (n) => round2(n * servings)) };
}

// Per-100 g values for a serving of known weight. With an unknown weight every value is unknown.
export function per100gToServing(values: Per100g, servingGrams: number | null): PerServing {
  if (values.basis !== 'per_100g') throw new Error('Expected values per 100 g');
  if (servingGrams !== null && (!Number.isFinite(servingGrams) || servingGrams <= 0)) throw new Error('Serving grams must be a positive number');
  return { basis: 'per_serving', ...mapValues(values, (n) => (servingGrams === null ? null : round2((n * servingGrams) / 100))) };
}

// Grams for a quantity, or null when it cannot be known. Mass units convert directly. For anything else the caller
// supplies grams per one unit (grams per ml, or grams per piece); without it the weight is unknown, never assumed.
export function toGrams(quantity: Quantity, gramsPerUnit?: number): number | null {
  if (!Number.isFinite(quantity.amount) || quantity.amount < 0) throw new Error('Amount must be a number of zero or more');
  if (gramsPerUnit !== undefined && (!Number.isFinite(gramsPerUnit) || gramsPerUnit <= 0)) throw new Error('Grams per unit must be positive');
  if (quantity.unit === 'g') return quantity.amount;
  if (quantity.unit === 'kg') return round2(quantity.amount * 1000);
  return gramsPerUnit === undefined ? null : round2(quantity.amount * gramsPerUnit);
}
