// Saving and reading the member's meal plan. The server decides everything (premium, revision, reviewed recipes); the
// app sends the request id and the revision it saw, and reports what happened. Keep the request id for a retry after
// an offline answer: the same id always gets the same result.
import { supabase } from '../../lib/supabase';

export interface Selection {
  recipeId: string;
  version: number;
  servings: number;
  day: number;
  slot: number;
}

export interface SaveInput {
  requestId: string;
  expectedRevision: number; // 0 when there is no saved plan yet
  selections: Selection[];
}

export type SaveResult =
  | { kind: 'saved'; revision: number; repeated: boolean }
  | { kind: 'stale'; revision: number } // the plan changed elsewhere: reload it
  | { kind: 'premium_required' }
  | { kind: 'recipe_unavailable' }
  | { kind: 'invalid' }
  | { kind: 'offline' } // no answer arrived: retry with the SAME request id
  | { kind: 'error' };

export type SavedPlan = { kind: 'plan'; revision: number; selections: Selection[] } | { kind: 'none'; revision: 0 } | { kind: 'unreadable' };

async function failureOf(error: unknown): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const e = error as { name?: string; context?: { status?: number; json?: () => Promise<unknown> } } | null;
  if (e?.name !== 'FunctionsHttpError' || typeof e.context?.status !== 'number') return null;
  let body: Record<string, unknown> = {};
  try {
    const parsed = await e.context.json?.();
    if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: e.context.status, body };
}

export async function saveMealPlan(input: SaveInput): Promise<SaveResult> {
  const { data, error } = await supabase.functions.invoke('meal-plan', { method: 'POST', body: { requestId: input.requestId, expectedRevision: input.expectedRevision, selections: input.selections } });
  if (error) {
    const failure = await failureOf(error);
    if (!failure) return { kind: 'offline' };
    const code = failure.body.error;
    if (code === 'REVISION_CONFLICT' && typeof failure.body.revision === 'number') return { kind: 'stale', revision: failure.body.revision };
    if (code === 'PREMIUM_REQUIRED') return { kind: 'premium_required' };
    if (code === 'RECIPE_UNAVAILABLE') return { kind: 'recipe_unavailable' };
    if (code === 'invalid_request') return { kind: 'invalid' };
    return { kind: 'error' };
  }
  const answer = data as { status?: unknown; revision?: unknown } | null;
  if (typeof answer?.revision !== 'number') return { kind: 'error' };
  return { kind: 'saved', revision: answer.revision, repeated: answer.status === 'existing' };
}

// The signed-in member's own plan (row-level security answers only for them).
export async function loadSavedPlan(): Promise<SavedPlan> {
  const { data, error } = await supabase.from('meal_plans').select('revision, selections').maybeSingle();
  if (error) return { kind: 'unreadable' };
  if (!data) return { kind: 'none', revision: 0 };
  const row = data as { revision?: unknown; selections?: unknown };
  if (typeof row.revision !== 'number' || !Array.isArray(row.selections)) return { kind: 'unreadable' };
  return { kind: 'plan', revision: row.revision, selections: row.selections as Selection[] };
}
