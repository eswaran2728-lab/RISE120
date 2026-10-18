// Starting a workout session. The server stores an immutable snapshot of a published template for today and
// returns it; the app keeps no copy of its own rules. The request id makes a retry after a lost answer safe: the
// same id always gets the same session back.
import { supabase } from '../lib/supabase';

export interface StartSessionInput {
  requestId: string; // keep it for retries after an offline or error answer
  planId: string;
  dayNumber: number;
  templateId: string;
  templateVersion: number;
}

export interface SessionSnapshot {
  templateId: string;
  version: number;
  minutes: number;
  exercises: { exerciseId: string; sets: number; reps: number; name: { en: string; ms: string; ta: string }; pattern: string; equipment: string }[];
}

export type StartSessionResult =
  | { kind: 'started'; sessionId: string; resumed: boolean; snapshot: SessionSnapshot }
  | { kind: 'template_unavailable' }
  | { kind: 'plan_not_found' }
  | { kind: 'day_not_available' }
  | { kind: 'invalid' }
  | { kind: 'offline' } // no answer arrived: retry with the SAME request id
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

export async function startSession(input: StartSessionInput): Promise<StartSessionResult> {
  const { data, error } = await supabase.functions.invoke('start-session', { method: 'POST', body: input });

  if (error) {
    const failure = await failureOf(error);
    if (!failure) return { kind: 'offline' };
    const code = failure.body.error;
    if (failure.status === 404) return { kind: code === 'PLAN_NOT_FOUND' ? 'plan_not_found' : 'template_unavailable' };
    if (failure.status === 409) return { kind: 'day_not_available' };
    if (failure.status === 400) return { kind: 'invalid' };
    return { kind: 'error' };
  }

  const answer = data as { sessionId?: unknown; status?: unknown; snapshot?: unknown } | null;
  if (typeof answer?.sessionId !== 'string' || typeof answer.snapshot !== 'object' || answer.snapshot === null) return { kind: 'error' };
  return { kind: 'started', sessionId: answer.sessionId, resumed: answer.status === 'existing' || answer.status === 'resumed', snapshot: answer.snapshot as SessionSnapshot };
}
