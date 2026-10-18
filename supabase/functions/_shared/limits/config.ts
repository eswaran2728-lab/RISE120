// Reads the free-tier limits from the server's app_config rows. Nothing here has a default: a missing
// or malformed value is reported so the caller can fail closed instead of guessing a limit.
export interface LimitConfig {
  freePlanDays: number;
  freeFoodLogsPerDay: number;
  freeAiMessagesPerDay: number;
  adRewardsMaxPerDay: number;
  adRewardFoodLogs: number;
  adRewardAiMessages: number;
  // When true, manual food logging has no daily limit for anyone. Off unless the server says true.
  manualFoodUnlimited: boolean;
}

const KEYS: Record<Exclude<keyof LimitConfig, 'manualFoodUnlimited'>, string> = {
  freePlanDays: 'free_plan_days',
  freeFoodLogsPerDay: 'free_food_logs_per_day',
  freeAiMessagesPerDay: 'free_ai_messages_per_day',
  adRewardsMaxPerDay: 'ad_rewards_max_per_day',
  adRewardFoodLogs: 'ad_reward_food_logs',
  adRewardAiMessages: 'ad_reward_ai_messages',
};

const MAX_LIMIT = 100000;

export type ConfigResult = { ok: true; config: LimitConfig } | { ok: false; key: string };

export function parseLimitConfig(rows: { key: string; value: unknown }[]): ConfigResult {
  const config: Partial<LimitConfig> = {};
  for (const [field, key] of Object.entries(KEYS) as [Exclude<keyof LimitConfig, 'manualFoodUnlimited'>, string][]) {
    const value = rows.find((row) => row.key === key)?.value;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_LIMIT) return { ok: false, key };
    config[field] = value;
  }
  // The switch is optional: a missing row keeps the old limit. A row of the wrong type is reported, never guessed.
  const flag = rows.find((row) => row.key === 'manual_food_unlimited')?.value;
  if (flag !== undefined && typeof flag !== 'boolean') return { ok: false, key: 'manual_food_unlimited' };
  config.manualFoodUnlimited = flag === true;
  return { ok: true, config: config as LimitConfig };
}
