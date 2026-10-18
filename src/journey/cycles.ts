// Starting the next 120-day cycle. The server decides everything (the account comes from the token, the plan is
// built from the stored profile). The app sends a request id so a lost answer can be retried safely: the same id
// always answers with the same cycle.
import { clearCache } from '../cache/userCache';
import { supabase } from '../lib/supabase';
import { notifyPlanChanged } from '../plan/planEvents';

export type CycleMode = 'progression' | 'maintenance';

export interface StartCycleInput {
  requestId: string; // keep it for retries after an offline or error answer
  mode: CycleMode;
  startDate: string; // the member's local date, YYYY-MM-DD
}

export type StartCycleResult =
  | { kind: 'started'; planId: string; cycleNumber: number; created: boolean }
  | { kind: 'not_finished' }
  | { kind: 'no_plan' }
  | { kind: 'profile_incomplete' }
  | { kind: 'invalid' }
  | { kind: 'offline' } // no answer arrived: retry with the SAME request id
  | { kind: 'error' };

async function failureStatus(error: unknown): Promise<{ status: number; body: Record<string, unknown> } | null> {
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

export async function startNextCycle(userId: string, input: StartCycleInput): Promise<StartCycleResult> {
  const { data, error } = await supabase.functions.invoke('start-next-cycle', {
    method: 'POST',
    body: { requestId: input.requestId, mode: input.mode, startDate: input.startDate },
  });

  if (error) {
    const failure = await failureStatus(error);
    if (!failure) return { kind: 'offline' };
    if (failure.status === 409) return { kind: 'not_finished' };
    if (failure.status === 404) return { kind: 'no_plan' };
    if (failure.status === 422) return { kind: 'profile_incomplete' };
    if (failure.status === 400) return { kind: 'invalid' };
    return { kind: 'error' };
  }

  const answer = data as { planId?: unknown; created?: unknown; cycleNumber?: unknown } | null;
  if (typeof answer?.planId !== 'string' || typeof answer.cycleNumber !== 'number') return { kind: 'error' };

  // The saved plan on this phone is the old cycle. Drop it and tell open screens, so the old cycle is never
  // shown as current while the new one is read.
  notifyPlanChanged(userId);
  await clearCache(userId, 'plan').catch(() => undefined);
  return { kind: 'started', planId: answer.planId, cycleNumber: answer.cycleNumber, created: answer.created === true };
}
