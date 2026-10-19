// The recipes a member can see, as the app reads them: published shared recipes plus the member's own private ones
// (the database decides, by row-level security). The app applies the same rules again to what it reads and what it
// remembers, so an unpublished shared recipe, another account's private recipe, or one whose claims its ingredients
// cannot support is never shown. Kept on this phone per account for offline use.
import { readCache, writeCache } from '../cache/userCache';
import { supabase } from '../lib/supabase';
import { validateRecipes } from './recipeRules';
import type { Cooking, DietLabel, FreeFrom, Localised, Price, Provenance, Recipe, RecipeIngredient, RecipeStatus } from './recipes';

const STATUSES: RecipeStatus[] = ['draft', 'in_review', 'published', 'private'];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isLocalised = (v: unknown): v is Localised => isRecord(v) && typeof v.en === 'string' && typeof v.ms === 'string' && typeof v.ta === 'string';
const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Maps one database row (snake_case) to a Recipe, or null when it is not the expected shape. Nothing is invented: an
// absent value stays null.
export function mapRecipeRow(row: unknown): Recipe | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== 'string' || typeof row.version !== 'number' || !STATUSES.includes(row.status as RecipeStatus)) return null;
  if (!isLocalised(row.name) || typeof row.servings !== 'number' || !Array.isArray(row.ingredients)) return null;
  if (!Array.isArray(row.preparation) || !row.preparation.every(isLocalised)) return null;

  let nutrition: Recipe['nutrition'] = null;
  if (isRecord(row.nutrition) && isRecord(row.nutrition.perServing) && isRecord(row.nutrition.provenance)) {
    const n = row.nutrition.perServing;
    nutrition = {
      perServing: { basis: 'per_serving', calories: numberOrNull(n.calories), proteinG: numberOrNull(n.proteinG), carbsG: numberOrNull(n.carbsG), fatG: numberOrNull(n.fatG), fibreG: numberOrNull(n.fibreG), sugarG: numberOrNull(n.sugarG), sodiumMg: numberOrNull(n.sodiumMg) },
      provenance: row.nutrition.provenance as unknown as Provenance,
    };
  }
  return {
    id: row.id,
    version: row.version,
    userId: typeof row.user_id === 'string' ? row.user_id : null,
    status: row.status as RecipeStatus,
    verified: row.verified === true,
    region: typeof row.region === 'string' ? row.region : null,
    name: row.name,
    aliases: isRecord(row.aliases) ? (row.aliases as Recipe['aliases']) : {},
    servings: row.servings,
    ingredients: row.ingredients as RecipeIngredient[],
    preparation: row.preparation,
    prepMinutes: numberOrNull(row.prep_minutes),
    cookMinutes: numberOrNull(row.cook_minutes),
    cooking: Array.isArray(row.cooking) ? (row.cooking as Cooking[]) : [],
    dietLabels: Array.isArray(row.diet_labels) ? (row.diet_labels as DietLabel[]) : [],
    freeFrom: Array.isArray(row.free_from) ? (row.free_from as FreeFrom[]) : [],
    nutrition,
    price: isRecord(row.price) ? (row.price as unknown as Price) : null,
    reviewer: isRecord(row.reviewer) ? (row.reviewer as unknown as NonNullable<Recipe['reviewer']>) : null,
  };
}

// What this account may see from a list of rows (fresh or remembered): own private, shared published, valid, newest.
function visible(userId: string, rows: unknown[]): Recipe[] {
  const newest = new Map<string, Recipe>();
  for (const raw of rows) {
    const recipe = mapRecipeRow(raw);
    if (!recipe) continue;
    if (recipe.userId !== null ? recipe.userId !== userId : recipe.status !== 'published') continue;
    if (validateRecipes([recipe]).length > 0) continue;
    const key = `${recipe.userId ?? 'shared'}|${recipe.id}`;
    const seen = newest.get(key);
    if (!seen || recipe.version > seen.version) newest.set(key, recipe);
  }
  return [...newest.values()];
}

const COLUMNS = 'id, version, user_id, status, verified, region, name, aliases, servings, ingredients, preparation, prep_minutes, cook_minutes, cooking, diet_labels, free_from, nutrition, price, reviewer';

export async function loadRecipes(userId: string): Promise<Recipe[]> {
  try {
    const { data, error } = await supabase.from('recipes').select(COLUMNS);
    if (!error && Array.isArray(data)) {
      await writeCache(userId, 'recipes', data);
      return visible(userId, data);
    }
  } catch {
    // Offline: fall back to what was read last.
  }
  const cached = await readCache<unknown[]>(userId, 'recipes');
  return Array.isArray(cached) ? visible(userId, cached) : [];
}
