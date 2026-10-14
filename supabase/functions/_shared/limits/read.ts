// The limit read model: what a user may still do today. Every number comes from the server (app_config,
// entitlements, usage and the verified ad-credit ledger); the app only displays it and never decides
// authorization. The quota day is UTC and resets at 00:00 UTC.
import { LimitConfig, parseLimitConfig } from './config.ts';

const PLAN_LENGTH = 120;
const DAY_MS = 86400000;

export type Tier = 'free' | 'premium';

export interface Allowance {
  used: number;
  base: number | null; // null = unlimited (premium)
  bonus: number;
  remaining: number | null; // null = unlimited (premium)
}

export interface LimitSnapshot {
  tier: Tier;
  quotaDayUtc: string;
  resetsAt: string;
  planDaysAccessible: number;
  food: Allowance;
  ai: Allowance;
  adRewards: { used: number; max: number; remaining: number };
}

export const quotaDayUtc = (now: Date): string => now.toISOString().slice(0, 10);

export function nextResetUtc(now: Date): string {
  const midnight = Date.parse(`${quotaDayUtc(now)}T00:00:00.000Z`);
  return new Date(midnight + DAY_MS).toISOString();
}

export interface SnapshotInput {
  tier: Tier;
  now: Date;
  config: LimitConfig;
  foodUsed: number;
  aiUsed: number;
  foodCredits: number;
  aiCredits: number;
  adsUsed: number;
}

export function buildLimitSnapshot(input: SnapshotInput): LimitSnapshot {
  const { tier, config } = input;
  const premium = tier === 'premium';
  const allowance = (used: number, base: number, credits: number): Allowance =>
    premium ? { used, base: null, bonus: 0, remaining: null } : { used, base, bonus: credits, remaining: Math.max(0, base + credits - used) };

  return {
    tier,
    quotaDayUtc: quotaDayUtc(input.now),
    resetsAt: nextResetUtc(input.now),
    planDaysAccessible: premium ? PLAN_LENGTH : Math.min(config.freePlanDays, PLAN_LENGTH),
    food: allowance(input.foodUsed, config.freeFoodLogsPerDay, input.foodCredits),
    ai: allowance(input.aiUsed, config.freeAiMessagesPerDay, input.aiCredits),
    // Premium sees no ads and no ad rewards.
    adRewards: premium
      ? { used: 0, max: 0, remaining: 0 }
      : { used: input.adsUsed, max: config.adRewardsMaxPerDay, remaining: Math.max(0, config.adRewardsMaxPerDay - input.adsUsed) },
  };
}

// A minimal view of the Supabase client, so this module stays free of runtime imports.
// deno-lint-ignore no-explicit-any
type Db = any;

export type LoadResult =
  | { ok: true; snapshot: LimitSnapshot }
  | { ok: false; reason: 'config'; key: string }
  | { ok: false; reason: 'read' };

// Reads the caller's own rows with the service role, so the user id must come from a verified token.
export async function loadLimitSnapshot(db: Db, userId: string, now: Date = new Date()): Promise<LoadResult> {
  const day = quotaDayUtc(now);

  const [configRows, premium, foodCount, usage, credits] = await Promise.all([
    db.from('app_config').select('key, value'),
    // Database time decides: a lapsed subscription is free even if entitlements.tier is still 'premium'.
    db.rpc('is_premium_now', { p_user_id: userId }),
    db.from('food_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('accepted_utc_date', day),
    db.from('usage_daily').select('ai_messages').eq('user_id', userId).eq('usage_date', day).maybeSingle(),
    db.from('ad_credits').select('reward_type, credits').eq('user_id', userId).eq('quota_day', day),
  ]);
  if (configRows.error || premium.error || foodCount.error || usage.error || credits.error) return { ok: false, reason: 'read' };

  const parsed = parseLimitConfig(configRows.data ?? []);
  if (!parsed.ok) return { ok: false, reason: 'config', key: parsed.key };

  const rows: { reward_type: string; credits: number }[] = credits.data ?? [];
  const sum = (type: string) => rows.filter((row) => row.reward_type === type).reduce((total, row) => total + row.credits, 0);

  return {
    ok: true,
    snapshot: buildLimitSnapshot({
      tier: premium.data === true ? 'premium' : 'free',
      now,
      config: parsed.config,
      foodUsed: foodCount.count ?? 0,
      aiUsed: usage.data?.ai_messages ?? 0,
      foodCredits: sum('food'),
      aiCredits: sum('ai'),
      adsUsed: rows.length,
    }),
  };
}
