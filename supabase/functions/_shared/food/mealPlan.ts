// Pure parsing for the meal-plan endpoint. The account always comes from the verified token; only these fields are read.
export interface MealSelection {
  recipeId: string;
  version: number;
  servings: number;
  day: number;
  slot: number;
}

export type SaveMealPlanRequest = { ok: true; requestId: string; expectedRevision: number; selections: MealSelection[] } | { ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECIPE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_SELECTIONS = 42; // 7 days of 6 meals

export function parseSaveMealPlanRequest(body: unknown): SaveMealPlanRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  if (typeof b.requestId !== 'string' || !UUID.test(b.requestId)) return { ok: false };
  if (typeof b.expectedRevision !== 'number' || !Number.isInteger(b.expectedRevision) || b.expectedRevision < 0) return { ok: false };
  if (!Array.isArray(b.selections) || b.selections.length < 1 || b.selections.length > MAX_SELECTIONS) return { ok: false };

  const seen = new Set<string>();
  const selections: MealSelection[] = [];
  for (const raw of b.selections) {
    if (typeof raw !== 'object' || raw === null) return { ok: false };
    const s = raw as Record<string, unknown>;
    if (typeof s.recipeId !== 'string' || !RECIPE_ID.test(s.recipeId)) return { ok: false };
    if (typeof s.version !== 'number' || !Number.isInteger(s.version) || s.version < 1) return { ok: false };
    if (typeof s.servings !== 'number' || !Number.isFinite(s.servings) || s.servings <= 0 || s.servings > 50) return { ok: false };
    if (typeof s.day !== 'number' || !Number.isInteger(s.day) || s.day < 0 || s.day > 6) return { ok: false };
    if (typeof s.slot !== 'number' || !Number.isInteger(s.slot) || s.slot < 0 || s.slot > 5) return { ok: false };
    const key = `${s.day}:${s.slot}`;
    if (seen.has(key)) return { ok: false };
    seen.add(key);
    selections.push({ recipeId: s.recipeId, version: s.version, servings: s.servings, day: s.day, slot: s.slot });
  }
  return { ok: true, requestId: b.requestId.toLowerCase(), expectedRevision: b.expectedRevision, selections };
}
