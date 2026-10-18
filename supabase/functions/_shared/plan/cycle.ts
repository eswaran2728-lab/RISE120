// Pure rules for starting the next plan cycle. The endpoint reads only three fields from the body (the account
// always comes from the verified token) and the plan content is always built by the server from the stored
// profile, never taken from the request.
import type { PlanProfile } from './types.ts';

export type CycleMode = 'progression' | 'maintenance';

export type CycleRequest = { ok: true; requestId: string; mode: CycleMode; startDate: string } | { ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86400000;

// The client sends its own calendar date, which can differ from UTC by up to about a day.
export function parseCycleRequest(body: unknown, now: Date = new Date()): CycleRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false };
  const { requestId, mode, startDate } = body as Record<string, unknown>;
  if (typeof requestId !== 'string' || !UUID.test(requestId)) return { ok: false };
  if (mode !== 'progression' && mode !== 'maintenance') return { ok: false };
  if (typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { ok: false };
  const parsed = Date.parse(`${startDate}T00:00:00Z`);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== startDate) return { ok: false };
  if (Math.abs(parsed - now.getTime()) > 2 * DAY_MS) return { ok: false };
  return { ok: true, requestId: requestId.toLowerCase(), mode, startDate };
}

// Until reviewed progression rules exist (roadmap C2), both modes use the same generator. A maintenance cycle
// plans maintenance calories: the plan's recomposition setting has no calorie adjustment. Nothing else changes.
export function profileForMode(profile: PlanProfile, mode: CycleMode): PlanProfile {
  return mode === 'maintenance' ? { ...profile, goal: 'recomp' } : { ...profile };
}
