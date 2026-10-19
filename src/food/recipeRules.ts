// Checks recipes with the rules a recipe must meet before a member can see it. Pure: no database, no network. A claim
// the ingredients cannot support is an error, and unknown ingredient tags never support a claim.
import { UNITS } from './portions';
import { COOKING, DIET_LABELS, FREE_FROM, Recipe, type DietLabel, type FreeFrom, type Tag } from './recipes';

export type RecipeErrorCode =
  | 'duplicate_recipe'
  | 'bad_servings'
  | 'no_ingredients'
  | 'bad_ingredient'
  | 'bad_nutrient'
  | 'nutrition_basis'
  | 'nutrition_inconsistent'
  | 'missing_nutrition_source'
  | 'diet_label_unknown'
  | 'diet_label_unsupported'
  | 'free_from_unknown'
  | 'free_from_unsupported'
  | 'price_invalid'
  | 'price_currency_mismatch'
  | 'missing_review'
  | 'missing_name'
  | 'missing_preparation'
  | 'verified_unreviewed'
  | 'private_not_private'
  | 'ingredient_private'
  | 'ingredient_unknown'
  | 'alias_invalid'
  | 'cooking_unknown';

export interface RecipeError {
  code: RecipeErrorCode;
  id: string;
}

// "source:sourceId" -> who owns that food (null = shared).
export type FoodIndex = Map<string, { userId: string | null }>;

const REGION_CURRENCY: Record<string, string> = { MY: 'MYR' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const filled = (text: unknown) => typeof text === 'string' && text.trim().length > 0;
const localisedComplete = (text: Recipe['name'] | undefined) => !!text && filled(text.en) && filled(text.ms) && filled(text.ta);
const reviewerComplete = (r: Recipe['reviewer']) => !!r && filled(r.name) && filled(r.role) && DATE.test(r.reviewedOn ?? '');
const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

const NOT_VEGETARIAN: Tag[] = ['meat', 'pork', 'fish', 'shellfish'];
const NOT_VEGAN: Tag[] = [...NOT_VEGETARIAN, 'dairy', 'egg', 'honey'];

export function validateRecipes(recipes: Recipe[], foods?: FoodIndex): RecipeError[] {
  const errors: RecipeError[] = [];
  const add = (code: RecipeErrorCode, id: string) => {
    if (!errors.some((e) => e.code === code && e.id === id)) errors.push({ code, id });
  };

  const seen = new Set<string>();
  for (const r of recipes) {
    const key = `${r.userId ?? 'shared'}|${r.id}|${r.version}`;
    if (seen.has(key)) add('duplicate_recipe', r.id);
    seen.add(key);

    if (!isNumber(r.servings) || r.servings <= 0) add('bad_servings', r.id);
    if (!Array.isArray(r.ingredients) || r.ingredients.length === 0) add('no_ingredients', r.id);
    for (const i of r.ingredients ?? []) {
      if (!filled(i.ref?.source) || !filled(i.ref?.sourceId) || !isNumber(i.amount) || i.amount <= 0 || !UNITS.includes(i.unit)) add('bad_ingredient', r.id);
      if (foods && filled(i.ref?.source) && filled(i.ref?.sourceId)) {
        const food = foods.get(`${i.ref.source}:${i.ref.sourceId}`);
        if (!food) add('ingredient_unknown', r.id);
        else if (food.userId !== null && food.userId !== r.userId) add('ingredient_private', r.id);
      }
    }

    // Nutrition: unknown is null. A number must be non-negative and per serving.
    if (r.nutrition) {
      const n = r.nutrition.perServing;
      if (n.basis !== 'per_serving') add('nutrition_basis', r.id);
      for (const key of ['calories', 'proteinG', 'carbsG', 'fatG', 'fibreG', 'sugarG', 'sodiumMg'] as const) {
        if (n[key] !== null && (!isNumber(n[key]) || (n[key] as number) < 0)) add('bad_nutrient', r.id);
      }
      if (isNumber(n.calories) && isNumber(n.proteinG) && isNumber(n.carbsG) && isNumber(n.fatG) && n.calories > 0) {
        const fromMacros = 4 * n.proteinG + 4 * n.carbsG + 9 * n.fatG;
        if (Math.abs(n.calories - fromMacros) / n.calories > 0.25) add('nutrition_inconsistent', r.id);
      }
    }

    // Claims need known ingredients that do not contradict them.
    const tagsOf = r.ingredients?.map((i) => i.tags) ?? [];
    const allKnown = tagsOf.every((t) => Array.isArray(t));
    const has = (banned: Tag[]) => tagsOf.some((t) => Array.isArray(t) && t.some((tag) => banned.includes(tag)));
    for (const label of r.dietLabels ?? []) {
      if (!DIET_LABELS.includes(label)) add('diet_label_unknown', r.id);
      else if (!allKnown || has(label === 'vegan' ? NOT_VEGAN : NOT_VEGETARIAN)) add('diet_label_unsupported', r.id);
    }
    for (const claim of r.freeFrom ?? []) {
      if (!FREE_FROM.includes(claim)) add('free_from_unknown', r.id);
      else if (!allKnown || has([claim as Tag])) add('free_from_unsupported', r.id);
    }
    for (const c of r.cooking ?? []) if (!COOKING.includes(c)) add('cooking_unknown', r.id);

    // Price: optional; when present it is dated, sourced, in the currency of the region.
    if (r.price) {
      const p = r.price;
      const currencyShape = typeof p.currency === 'string' && /^[A-Z]{3}$/.test(p.currency);
      if (!isNumber(p.amount) || p.amount < 0 || !DATE.test(p.pricedOn ?? '') || !filled(p.source) || !isNumber(p.servings) || p.servings <= 0 || !currencyShape) add('price_invalid', r.id);
      else {
        const expected = r.region ? REGION_CURRENCY[r.region] : undefined;
        if (expected && p.currency !== expected) add('price_currency_mismatch', r.id);
      }
    }

    for (const [lang, list] of Object.entries(r.aliases ?? {})) {
      if (!['en', 'ms', 'ta'].includes(lang) || !Array.isArray(list) || list.some((a) => !filled(a))) add('alias_invalid', r.id);
    }

    // Publication, review and verification.
    if (r.userId !== null) {
      if (r.status !== 'private' || r.verified || r.reviewer) add('private_not_private', r.id);
    } else {
      if (r.verified && (r.status !== 'published' || !reviewerComplete(r.reviewer))) add('verified_unreviewed', r.id);
      if (r.status === 'published') {
        if (!reviewerComplete(r.reviewer)) add('missing_review', r.id);
        if (!localisedComplete(r.name)) add('missing_name', r.id);
        if (!Array.isArray(r.preparation) || r.preparation.length === 0 || !r.preparation.every(localisedComplete)) add('missing_preparation', r.id);
        const p = r.nutrition?.provenance;
        if (!p || !filled(p.name) || !filled(p.version) || !DATE.test(p.accessedOn ?? '') || !filled(p.licenceEvidence)) add('missing_nutrition_source', r.id);
      }
    }
  }
  return errors;
}

export type { DietLabel, FreeFrom };
