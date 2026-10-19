// Local recipes with their provenance. A recipe lists explicit ingredient references (to foods by source and source id),
// quantities and units, a yield in servings, preparation, the equipment it needs, the diet labels its ingredients
// support, regional names, the source and version of its nutrition, and optionally a dated price with a currency.
// Unknown nutrients and prices are null, never 0. Only reviewed recipes are ever offered to a member; this file holds
// the types and the arithmetic, recipeRules.ts the validation, and recipeData.ts the read model.
import { per100gToServing, scaleAmount, scaleServingsFactor, servingNutrition, type PerServing, type Unit } from './portions';

export type Localised = { en: string; ms: string; ta: string };
export type RecipeStatus = 'draft' | 'in_review' | 'published' | 'private';

// What an ingredient is, as far as allergy and diet claims go. `null` tags mean unknown, and unknown never supports a claim.
export type Tag = 'meat' | 'pork' | 'fish' | 'shellfish' | 'dairy' | 'egg' | 'honey' | 'gluten' | 'peanut' | 'tree_nut' | 'soy' | 'sesame' | 'alcohol';
export const TAGS: readonly Tag[] = ['meat', 'pork', 'fish', 'shellfish', 'dairy', 'egg', 'honey', 'gluten', 'peanut', 'tree_nut', 'soy', 'sesame', 'alcohol'];

// Claims a recipe may make, and only if every ingredient is known and none contradicts it. "Halal" is a certification,
// not a property of ingredients, so it is not a label this system can support.
export type DietLabel = 'vegetarian' | 'vegan';
export const DIET_LABELS: readonly DietLabel[] = ['vegetarian', 'vegan'];
export type FreeFrom = 'peanut' | 'tree_nut' | 'dairy' | 'egg' | 'gluten' | 'soy' | 'shellfish' | 'fish' | 'sesame';
export const FREE_FROM: readonly FreeFrom[] = ['peanut', 'tree_nut', 'dairy', 'egg', 'gluten', 'soy', 'shellfish', 'fish', 'sesame'];

export type Cooking = 'none' | 'stovetop' | 'rice_cooker' | 'oven' | 'microwave' | 'kettle';
export const COOKING: readonly Cooking[] = ['none', 'stovetop', 'rice_cooker', 'oven', 'microwave', 'kettle'];

export interface IngredientRef {
  source: string; // the foods.source of the referenced food, e.g. 'curated' or 'usda'
  sourceId: string; // its foods.source_id
}

export interface RecipeIngredient {
  ref: IngredientRef;
  name: string; // for display only; the reference is the identity
  amount: number;
  unit: Unit;
  gramsPerUnit?: number; // for pieces and volumes, when known
  tags: Tag[] | null;
}

export interface Provenance {
  name: string;
  url: string | null;
  recordId: string | null;
  version: string; // the version or edition of the source that was read
  accessedOn: string; // YYYY-MM-DD
  licenceEvidence: string; // the written right to reuse it
}

export interface Price {
  amount: number;
  currency: string; // ISO 4217
  pricedOn: string; // YYYY-MM-DD
  servings: number; // the price is for this many servings
  source: string;
}

export interface Recipe {
  id: string;
  version: number;
  userId: string | null; // null = shared reviewed content; a user id = that member's private recipe
  status: RecipeStatus;
  verified: boolean;
  region: string | null;
  name: Localised;
  aliases: { en?: string[]; ms?: string[]; ta?: string[] };
  servings: number; // yield
  ingredients: RecipeIngredient[];
  preparation: Localised[];
  prepMinutes: number | null;
  cookMinutes: number | null;
  cooking: Cooking[]; // equipment needed; empty or ['none'] means none
  dietLabels: DietLabel[];
  freeFrom: FreeFrom[];
  nutrition: { perServing: PerServing; provenance: Provenance } | null;
  price: Price | null;
  reviewer: { name: string; role: string; reviewedOn: string } | null;
}

// The recipe scaled to a number of servings: ingredient amounts, per-serving nutrition for those servings, and the
// price for them. Anything unknown stays null.
export interface ScaledRecipe {
  servings: number;
  ingredients: { ref: IngredientRef; name: string; amount: number; unit: Unit }[];
  nutrition: PerServing | null;
  price: { amount: number; currency: string } | null;
}

export function scaleRecipe(recipe: Recipe, servings: number): ScaledRecipe {
  const factor = scaleServingsFactor(recipe.servings, servings);
  return {
    servings,
    ingredients: recipe.ingredients.map((i) => ({ ref: i.ref, name: i.name, amount: scaleAmount(i.amount, factor), unit: i.unit })),
    nutrition: recipe.nutrition ? servingNutrition(recipe.nutrition.perServing, servings) : null,
    price: recipe.price ? { amount: scaleAmount(recipe.price.amount, servings / recipe.price.servings), currency: recipe.price.currency } : null,
  };
}

export { per100gToServing };
