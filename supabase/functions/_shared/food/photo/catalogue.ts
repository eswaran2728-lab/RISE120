// Turns a provider's suggestions into candidates the member may review. Every candidate is a reference to a record that
// already exists and is eligible: a shared, sourced food (curated or USDA), or a shared, published recipe. A provider's
// own text, names, numbers and confidence wording never reach the member; names come from the catalogue, the
// uncertainty label is one of three fixed words, and the portion is a bounded suggestion. Unknown, private, other
// members', draft and fabricated references are dropped. No nutrition is returned at all.
import type { PhotoGuess } from './provider.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export const MAX_CANDIDATES = 5;
const MAX_GUESSES_READ = 20;
const MAX_NAME = 80;

export interface Candidate {
  kind: 'food' | 'recipe';
  id: string;
  version?: number; // recipes only
  name: string;
  uncertainty: 'likely' | 'possible' | 'unsure';
  servings: number | null;
  loggable: boolean; // false: the record has no complete sourced nutrition, so it can only lead to manual search
  provenance: { source: string; sourceId: string | null; verified: boolean; reviewed: boolean };
}

const FOOD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECIPE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const uncertaintyOf = (confidence: unknown): Candidate['uncertainty'] => (confidence === 'high' ? 'likely' : confidence === 'medium' ? 'possible' : 'unsure');

// A suggested portion in quarter servings between a quarter and ten, or none.
function servingsOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.25 || value > 10) return null;
  return Math.round(value * 4) / 4;
}

const name = (text: unknown) => (typeof text === 'string' ? text.trim().slice(0, MAX_NAME) : '');
const complete = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export async function lookupCandidates(db: Db, guesses: PhotoGuess[]): Promise<Candidate[]> {
  const seen = new Set<string>();
  const wanted: PhotoGuess[] = [];
  for (const raw of guesses.slice(0, MAX_GUESSES_READ)) {
    const g = raw as Partial<PhotoGuess> | null;
    if (!g || (g.kind !== 'food' && g.kind !== 'recipe') || typeof g.id !== 'string') continue;
    if (g.kind === 'food' ? !FOOD_ID.test(g.id) : !RECIPE_ID.test(g.id)) continue;
    const key = `${g.kind}:${g.id.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push({ kind: g.kind, id: g.kind === 'food' ? g.id.toLowerCase() : g.id, confidence: g.confidence, servings: g.servings });
  }
  const foodIds = wanted.filter((g) => g.kind === 'food').map((g) => g.id);
  const recipeIds = wanted.filter((g) => g.kind === 'recipe').map((g) => g.id);

  const foods = new Map<string, Record<string, any>>();
  if (foodIds.length > 0) {
    const { data, error } = await db
      .from('foods')
      .select('id, name, source, source_id, verified, calories, protein_g, carbs_g, fat_g')
      .in('id', foodIds)
      .is('user_id', null)
      .in('source', ['curated', 'usda']);
    if (error) throw new Error('catalogue_lookup_failed');
    for (const row of data ?? []) if (row.verified === true || (typeof row.source_id === 'string' && row.source_id !== '')) foods.set(row.id, row);
  }

  const recipes = new Map<string, Record<string, any>>();
  if (recipeIds.length > 0) {
    const { data, error } = await db.from('recipes').select('id, version, name, nutrition').in('id', recipeIds).is('user_id', null).eq('status', 'published');
    if (error) throw new Error('catalogue_lookup_failed');
    for (const row of data ?? []) {
      const best = recipes.get(row.id);
      if (!best || row.version > best.version) recipes.set(row.id, row);
    }
  }

  const out: Candidate[] = [];
  for (const g of wanted) {
    if (out.length >= MAX_CANDIDATES) break;
    if (g.kind === 'food') {
      const row = foods.get(g.id);
      if (!row || !name(row.name)) continue;
      const loggable = [row.calories, row.protein_g, row.carbs_g, row.fat_g].every((n) => complete(Number(n)) && n !== null);
      out.push({
        kind: 'food',
        id: row.id,
        name: name(row.name),
        uncertainty: uncertaintyOf(g.confidence),
        servings: servingsOf(g.servings),
        loggable,
        provenance: { source: row.source, sourceId: row.source_id ?? null, verified: row.verified === true, reviewed: row.verified === true },
      });
    } else {
      const row = recipes.get(g.id);
      const label = name(row?.name?.en);
      if (!row || !label) continue;
      const per = row.nutrition?.perServing ?? {};
      out.push({
        kind: 'recipe',
        id: row.id,
        version: row.version,
        name: label,
        uncertainty: uncertaintyOf(g.confidence),
        servings: servingsOf(g.servings),
        loggable: [per.calories, per.proteinG, per.carbsG, per.fatG].every((n) => complete(n)),
        provenance: { source: 'recipe', sourceId: `${row.id}@${row.version}`, verified: false, reviewed: true },
      });
    }
  }
  return out;
}
