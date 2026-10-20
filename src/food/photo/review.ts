// Candidate handling for the photo flow. The server returns bounded REFERENCES; this turns them into records the member
// can review under their own access, and is the only place a photo candidate becomes a meal: confirmPhotoCandidate,
// called after the member has checked the food, corrected the amount and pressed Save. Nothing here reads a photo, and no
// nutrition ever comes from the photo or from the server's answer: it comes from the food or recipe record itself.
import { supabase } from '../../lib/supabase';
import { queueFoodLog } from '../log';
import { recipeFoodSnapshot, queueRecipeLog } from '../mealPlanner/plannedLog';
import { FOOD_COLUMNS, mapFoodRow } from '../map';
import { loadRecipes } from '../recipeData';
import type { Recipe } from '../recipes';
import type { Food, MealType } from '../types';

export interface Candidate {
  kind: 'food' | 'recipe';
  id: string;
  version?: number; // recipes only
  name: string;
  uncertainty: 'likely' | 'possible' | 'unsure';
  servings: number | null; // a suggestion only, always editable
  loggable: boolean;
  provenance: { source: string; sourceId: string | null; verified: boolean; reviewed: boolean };
}

export const MAX_CANDIDATES = 5;
const MAX_NAME = 80;
const MAX_QUANTITY = 100;
const FOOD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECIPE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const UNCERTAINTY = new Set(['likely', 'possible', 'unsure']);

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

// Keeps only the fields the app uses, with bounded values; everything else a response might carry is dropped.
export function normalizeCandidates(raw: unknown): Candidate[] {
  if (!Array.isArray(raw)) return [];
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRow(item) || (item.kind !== 'food' && item.kind !== 'recipe') || typeof item.id !== 'string' || typeof item.name !== 'string') continue;
    if (item.kind === 'food' ? !FOOD_ID.test(item.id) : !RECIPE_ID.test(item.id)) continue;
    const name = item.name.trim().slice(0, MAX_NAME);
    const key = `${item.kind}:${item.id}`;
    if (!name || seen.has(key)) continue;
    const provenance = isRow(item.provenance) ? item.provenance : {};
    const servings = typeof item.servings === 'number' && Number.isFinite(item.servings) && item.servings >= 0.25 && item.servings <= 10 ? item.servings : null;
    seen.add(key);
    out.push({
      kind: item.kind,
      id: item.id,
      ...(item.kind === 'recipe' && typeof item.version === 'number' && Number.isInteger(item.version) && item.version >= 1 ? { version: item.version } : {}),
      name,
      uncertainty: UNCERTAINTY.has(String(item.uncertainty)) ? (item.uncertainty as Candidate['uncertainty']) : 'unsure',
      servings,
      loggable: item.loggable === true,
      provenance: {
        source: typeof provenance.source === 'string' ? provenance.source.slice(0, 40) : '',
        sourceId: typeof provenance.sourceId === 'string' ? provenance.sourceId.slice(0, 80) : null,
        verified: provenance.verified === true,
        reviewed: provenance.reviewed === true,
      },
    });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

export type Selected = { kind: 'food'; food: Food } | { kind: 'recipe'; recipe: Recipe };
export type ResolveResult = { kind: 'ok'; selected: Selected } | { kind: 'gone' } | { kind: 'offline' };

const SOURCED = new Set(['curated', 'usda']);
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const eligibleFood = (food: Food) => food.userId === null && SOURCED.has(food.source) && [food.calories, food.proteinG, food.carbsG, food.fatG].every(finite);
const eligibleRecipe = (recipe: Recipe) => recipe.status === 'published' && recipe.userId === null;

// The record behind a candidate, read under the member's own access. A record that is missing, private or no longer
// sourced is "gone": the candidate cannot be used.
export async function resolveCandidate(userId: string, candidate: Candidate): Promise<ResolveResult> {
  if (candidate.kind === 'recipe') {
    const recipes = await loadRecipes(userId);
    const found = recipes.find((r) => r.id === candidate.id && (candidate.version === undefined || r.version === candidate.version) && eligibleRecipe(r));
    return found ? { kind: 'ok', selected: { kind: 'recipe', recipe: found } } : { kind: 'gone' };
  }
  try {
    const { data, error } = await supabase.from('foods').select(FOOD_COLUMNS).eq('id', candidate.id).is('user_id', null).maybeSingle();
    if (error) return { kind: 'offline' };
    if (!data) return { kind: 'gone' };
    const food = mapFoodRow(data);
    return eligibleFood(food) ? { kind: 'ok', selected: { kind: 'food', food } } : { kind: 'gone' };
  } catch {
    return { kind: 'offline' };
  }
}

// A Food the entry sheet can show for the selection; null when a recipe's nutrition is incomplete (unloggable).
export function foodForSelection(userId: string, selected: Selected): Food | null {
  if (selected.kind === 'food') return selected.food;
  const n = selected.recipe.nutrition?.perServing;
  if (!n || n.calories === null || n.proteinG === null || n.carbsG === null || n.fatG === null) return null;
  return recipeFoodSnapshot(userId, selected.recipe, { calories: n.calories, proteinG: n.proteinG, carbsG: n.carbsG, fatG: n.fatG });
}

export type ConfirmResult = { kind: 'logged'; logId: string } | { kind: 'invalid_quantity' } | { kind: 'nutrition_unknown' } | { kind: 'not_eligible' };

// The one path from a photo candidate to a meal. The log id belongs to the entry, so repeating Save is one log; the food
// keeps its source and verified label; a recipe goes through its private food (queued first) exactly as in the planner.
export async function confirmPhotoCandidate(userId: string, date: string, selected: Selected, quantity: number, mealType: MealType, logId: string): Promise<ConfirmResult> {
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) return { kind: 'invalid_quantity' };
  if (selected.kind === 'food') {
    if (!eligibleFood(selected.food)) return { kind: 'not_eligible' };
    await queueFoodLog(userId, date, { id: logId, food: selected.food, quantity, mealType });
    return { kind: 'logged', logId };
  }
  if (!eligibleRecipe(selected.recipe)) return { kind: 'not_eligible' };
  return queueRecipeLog(userId, date, { recipe: selected.recipe, servings: quantity, mealType, logId });
}
