// Swapping the remaining sets of an exercise and finishing a started session. The server decides everything
// (ownership, revision, reviewed alternatives, equipment, completing once); the app only asks and reports.
// Every swap carries a request id and the revision the screen saw: keep the id for a retry after an offline answer.
import { supabase } from '../lib/supabase';
import type { Localised } from './catalogue';
import { parseSummary, SessionSummary } from './summary';

export interface SessionExercise {
  exerciseId: string;
  sets: number;
  reps: number;
  name: Localised;
  pattern: string;
  equipment: string;
  kept?: boolean; // the sets already done under the exercise that was swapped away
}

export interface SessionExercises {
  revision: number;
  status: 'active' | 'completed';
  exercises: SessionExercise[];
}

export interface SwapInput {
  sessionId: string;
  requestId: string;
  expectedRevision: number;
  fromExerciseId: string;
  replacementId: string;
}

export type SwapResult =
  | { kind: 'swapped'; revision: number; exercises: SessionExercise[]; repeated: boolean }
  | { kind: 'stale'; revision: number } // the session changed elsewhere: reload it
  | { kind: 'session_completed' }
  | { kind: 'not_found' }
  | { kind: 'equipment_unsuitable' }
  | { kind: 'not_an_alternative' }
  | { kind: 'already_in_session' }
  | { kind: 'replacement_unavailable' }
  | { kind: 'nothing_to_swap' }
  | { kind: 'offline' } // no answer arrived: retry with the SAME request id
  | { kind: 'error' };

export type CompleteResult =
  | { kind: 'completed'; summary: SessionSummary; completedAt: string; repeated: boolean }
  | { kind: 'nothing_logged' }
  | { kind: 'not_found' }
  | { kind: 'offline' }
  | { kind: 'error' };

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

const SWAP_REFUSALS: Record<string, SwapResult> = {
  SESSION_COMPLETED: { kind: 'session_completed' },
  SESSION_NOT_FOUND: { kind: 'not_found' },
  EQUIPMENT_UNSUITABLE: { kind: 'equipment_unsuitable' },
  NOT_AN_ALTERNATIVE: { kind: 'not_an_alternative' },
  ALREADY_IN_SESSION: { kind: 'already_in_session' },
  REPLACEMENT_UNAVAILABLE: { kind: 'replacement_unavailable' },
  NOTHING_TO_SWAP: { kind: 'nothing_to_swap' },
  EXERCISE_NOT_IN_SESSION: { kind: 'nothing_to_swap' },
};

function readExercises(raw: unknown): SessionExercise[] | null {
  if (!Array.isArray(raw)) return null;
  const list: SessionExercise[] = [];
  for (const entry of raw) {
    const e = entry as Record<string, unknown> | null;
    if (!e || typeof e.exerciseId !== 'string' || typeof e.sets !== 'number' || typeof e.reps !== 'number' || typeof e.name !== 'object' || e.name === null) return null;
    list.push(e as unknown as SessionExercise);
  }
  return list;
}

export async function swapRemainingExercise(input: SwapInput): Promise<SwapResult> {
  const { data, error } = await supabase.functions.invoke('session-actions', {
    method: 'POST',
    body: { action: 'swap', sessionId: input.sessionId, requestId: input.requestId, expectedRevision: input.expectedRevision, fromExerciseId: input.fromExerciseId, replacementId: input.replacementId },
  });
  if (error) {
    const failure = await failureOf(error);
    if (!failure) return { kind: 'offline' };
    const code = failure.body.error;
    if (code === 'REVISION_CONFLICT' && typeof failure.body.revision === 'number') return { kind: 'stale', revision: failure.body.revision };
    if (typeof code === 'string' && SWAP_REFUSALS[code]) return SWAP_REFUSALS[code];
    return { kind: 'error' };
  }
  const answer = data as { status?: unknown; revision?: unknown; exercises?: unknown } | null;
  const exercises = readExercises(answer?.exercises);
  if (typeof answer?.revision !== 'number' || !exercises) return { kind: 'error' };
  return { kind: 'swapped', revision: answer.revision, exercises, repeated: answer.status === 'existing' };
}

export async function completeSession(sessionId: string): Promise<CompleteResult> {
  const { data, error } = await supabase.functions.invoke('session-actions', { method: 'POST', body: { action: 'complete', sessionId } });
  if (error) {
    const failure = await failureOf(error);
    if (!failure) return { kind: 'offline' };
    if (failure.body.error === 'NOTHING_LOGGED') return { kind: 'nothing_logged' };
    if (failure.body.error === 'SESSION_NOT_FOUND') return { kind: 'not_found' };
    return { kind: 'error' };
  }
  const answer = data as { status?: unknown; summary?: unknown; completedAt?: unknown } | null;
  const summary = parseSummary(answer?.summary);
  if (!summary || typeof answer?.completedAt !== 'string') return { kind: 'error' };
  return { kind: 'completed', summary, completedAt: answer.completedAt, repeated: answer.status === 'existing' };
}

// The own session as it stands now (swaps applied). Null when it is not the caller session or cannot be read.
export async function loadSessionExercises(sessionId: string): Promise<SessionExercises | null> {
  const { data, error } = await supabase.rpc('session_exercises', { p_session_id: sessionId });
  if (error || !data) return null;
  const d = data as { revision?: unknown; status?: unknown; exercises?: unknown };
  const exercises = readExercises(d.exercises);
  if (typeof d.revision !== 'number' || (d.status !== 'active' && d.status !== 'completed') || !exercises) return null;
  return { revision: d.revision, status: d.status, exercises };
}
