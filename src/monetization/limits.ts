// What the signed-in user may still do today. Every number comes from the server's check-limit function
// (which reads app_config, entitlements and the verified ad ledger); the app displays it and never decides
// authorization or holds a limit of its own.
import { readCache, writeCache } from '../cache/userCache';
import { supabase } from '../lib/supabase';
import { dayNumberFor } from '../lib/dates';
import { PLAN_LENGTH } from '../today/selectors';
import type { LocalDate } from '../sync/types';

export interface Allowance {
  used: number;
  base: number | null; // null = unlimited (premium)
  bonus: number;
  remaining: number | null; // null = unlimited (premium)
}

export interface LimitSnapshot {
  tier: 'free' | 'premium';
  quotaDayUtc: string;
  resetsAt: string;
  planDaysAccessible: number;
  food: Allowance;
  ai: Allowance;
  adRewards: { used: number; max: number; remaining: number };
  // Absent in answers from an older server and in older remembered snapshots; use capabilitiesOf().
  capabilities?: Capabilities;
}

export interface Capabilities {
  basicPlan: boolean;
  manualFood: boolean;
  adaptiveProgression: boolean;
  mealPlanner: boolean;
  photoFood: boolean;
  coach: boolean;
}

const CAPABILITY_KEYS: (keyof Capabilities)[] = ['basicPlan', 'manualFood', 'adaptiveProgression', 'mealPlanner', 'photoFood', 'coach'];

function parseCapabilities(value: unknown): Capabilities | null {
  if (!isRecord(value)) return null;
  const out = {} as Capabilities;
  for (const key of CAPABILITY_KEYS) {
    if (typeof value[key] !== 'boolean') return null;
    out[key] = value[key] as boolean;
  }
  return out;
}

// What the account may use. The server's answer when it sent one; otherwise a restrictive reading of the
// allowances. With no snapshot nothing is assumed: the server still decides what is accepted.
export function capabilitiesOf(snapshot: LimitSnapshot | null): Capabilities {
  if (!snapshot) return { basicPlan: false, manualFood: false, adaptiveProgression: false, mealPlanner: false, photoFood: false, coach: false };
  if (snapshot.capabilities) return snapshot.capabilities;
  const premium = snapshot.tier === 'premium';
  return {
    basicPlan: snapshot.planDaysAccessible > 0,
    manualFood: snapshot.food.remaining === null || snapshot.food.remaining > 0,
    adaptiveProgression: premium,
    mealPlanner: premium,
    photoFood: premium,
    coach: snapshot.ai.remaining === null || snapshot.ai.remaining > 0,
  };
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function parseAllowance(value: unknown): Allowance | null {
  if (!isRecord(value)) return null;
  const { used, base, bonus, remaining } = value;
  if (!isNumber(used) || !isNumber(bonus)) return null;
  if (base !== null && !isNumber(base)) return null;
  if (remaining !== null && !isNumber(remaining)) return null;
  return { used, base, bonus, remaining };
}

export function parseLimitSnapshot(value: unknown): LimitSnapshot | null {
  if (!isRecord(value)) return null;
  const { tier, quotaDayUtc, resetsAt, planDaysAccessible, adRewards } = value;
  if (tier !== 'free' && tier !== 'premium') return null;
  if (typeof quotaDayUtc !== 'string' || typeof resetsAt !== 'string' || !Number.isFinite(Date.parse(resetsAt))) return null;
  if (!isNumber(planDaysAccessible)) return null;
  const food = parseAllowance(value.food);
  const ai = parseAllowance(value.ai);
  if (!food || !ai || !isRecord(adRewards)) return null;
  if (!isNumber(adRewards.used) || !isNumber(adRewards.max) || !isNumber(adRewards.remaining)) return null;
  const parsed: LimitSnapshot = { tier, quotaDayUtc, resetsAt, planDaysAccessible, food, ai, adRewards: { used: adRewards.used, max: adRewards.max, remaining: adRewards.remaining } };
  if ('capabilities' in value) {
    const capabilities = parseCapabilities(value.capabilities);
    if (!capabilities) return null;
    parsed.capabilities = capabilities;
  }
  return parsed;
}

export async function loadLimits(userId: string): Promise<LimitSnapshot> {
  const { data, error } = await supabase.functions.invoke('check-limit', { method: 'POST', body: {} });
  if (error) throw new Error(error.message);
  const snapshot = parseLimitSnapshot(data);
  if (!snapshot) throw new Error('Invalid limit response');
  await writeCache(userId, 'limits', snapshot);
  return snapshot;
}

export type AccessStatus = 'premium' | 'unverified' | 'free';

// Access is known only from a fresh server answer. A remembered answer, or none at all (offline, or check-limit
// failing), is "unverified": it must not be shown as confirmed premium, and it must not be treated as free either,
// because someone who may already be premium could then be offered a second purchase.
export function accessStatus(result: { snapshot: LimitSnapshot; stale: boolean } | null): AccessStatus {
  if (!result || result.stale) return 'unverified';
  return result.snapshot.tier === 'premium' ? 'premium' : 'free';
}

// With no signal the last answer for this account stands in, marked stale. It is only for display: the
// server decides what is accepted, so a stale or missing snapshot never grants or blocks anything.
export async function loadLimitsOrCached(userId: string): Promise<{ snapshot: LimitSnapshot; stale: boolean } | null> {
  try {
    return { snapshot: await loadLimits(userId), stale: false };
  } catch {
    const cached = parseLimitSnapshot(await readCache<unknown>(userId, 'limits'));
    return cached ? { snapshot: cached, stale: true } : null;
  }
}

// The plan day to show as locked, when today's plan day lies past what the server lets this user open.
// The plan itself stays stored; workouts and check-ins are never limited.
export function lockedPlanDay(plan: { startDate: LocalDate }, localDate: LocalDate, snapshot: LimitSnapshot | null): number | null {
  if (!snapshot) return null;
  const dayNumber = dayNumberFor(plan.startDate, localDate);
  if (dayNumber < 1 || dayNumber > PLAN_LENGTH) return null;
  return dayNumber > snapshot.planDaysAccessible ? dayNumber : null;
}

export type UnlockAction = 'subscribe' | 'watch_ad';

// What the screens may offer to lift a limit. An ad lifts only the food or AI allowance, never plan days.
export function unlockActions(snapshot: LimitSnapshot | null, context: 'food' | 'ai' | 'plan' = 'food'): UnlockAction[] {
  if (snapshot?.tier === 'premium') return [];
  if (!snapshot || context === 'plan') return ['subscribe'];
  return snapshot.adRewards.remaining > 0 ? ['subscribe', 'watch_ad'] : ['subscribe'];
}

// The server's reset instant (00:00 UTC) as a clock time in the device's time zone and in UTC.
export function formatReset(resetsAt: string, options: { timeZone?: string; locale?: string } = {}): { local: string; utc: string } {
  const instant = new Date(resetsAt);
  const clock = (timeZone?: string) =>
    new Intl.DateTimeFormat(options.locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(instant);
  return { local: clock(options.timeZone), utc: clock('UTC') };
}
