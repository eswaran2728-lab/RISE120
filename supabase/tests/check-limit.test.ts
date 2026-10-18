import { parseLimitConfig } from '../functions/_shared/limits/config';
import { buildLimitSnapshot, nextResetUtc, quotaDayUtc } from '../functions/_shared/limits/read';
import { callFunction, createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(180000);

const CONFIG_ROWS = [
  { key: 'free_plan_days', value: 14 },
  { key: 'free_food_logs_per_day', value: 3 },
  { key: 'free_ai_messages_per_day', value: 1 },
  { key: 'ad_rewards_max_per_day', value: 3 },
  { key: 'ad_reward_food_logs', value: 2 },
  { key: 'ad_reward_ai_messages', value: 1 },
  { key: 'manual_food_unlimited', value: false },
];

const config = (overrides: Record<string, unknown> = {}) => {
  const parsed = parseLimitConfig(CONFIG_ROWS.map((row) => ({ key: row.key, value: key(overrides, row) })));
  if (!parsed.ok) throw new Error(`bad fixture: ${parsed.key}`);
  return parsed.config;
};
const key = (overrides: Record<string, unknown>, row: { key: string; value: unknown }) => (row.key in overrides ? overrides[row.key] : row.value);

describe('parseLimitConfig (fails closed)', () => {
  it('reads the six server limits and the manual-food switch', () => {
    expect(config()).toEqual({
      freePlanDays: 14,
      freeFoodLogsPerDay: 3,
      freeAiMessagesPerDay: 1,
      adRewardsMaxPerDay: 3,
      adRewardFoodLogs: 2,
      adRewardAiMessages: 1,
      manualFoodUnlimited: false,
    });
  });

  describe('manual_food_unlimited', () => {
    it('is on only when the server says true', () => {
      expect(config({ manual_food_unlimited: true }).manualFoodUnlimited).toBe(true);
      expect(config({ manual_food_unlimited: false }).manualFoodUnlimited).toBe(false);
    });

    it('is off when the row is missing, so the old limit keeps applying', () => {
      const rows = CONFIG_ROWS.filter((row) => row.key !== 'manual_food_unlimited');

      expect(parseLimitConfig(rows)).toMatchObject({ ok: true, config: { manualFoodUnlimited: false } });
    });

    it.each([['a string', 'true'], ['a number', 1], ['null', null]])('rejects %s instead of guessing', (_label, value) => {
      const rows = CONFIG_ROWS.map((row) => (row.key === 'manual_food_unlimited' ? { ...row, value } : row));

      expect(parseLimitConfig(rows)).toEqual({ ok: false, key: 'manual_food_unlimited' });
    });
  });

  it('follows changed values', () => {
    expect(config({ free_food_logs_per_day: 5, free_plan_days: 20 })).toMatchObject({ freeFoodLogsPerDay: 5, freePlanDays: 20 });
  });

  it.each(CONFIG_ROWS.map((row) => row.key).filter((name) => name !== 'manual_food_unlimited'))('rejects a missing %s', (missing) => {
    const result = parseLimitConfig(CONFIG_ROWS.filter((row) => row.key !== missing));

    expect(result).toEqual({ ok: false, key: missing });
  });

  it.each([
    ['a string', '3'],
    ['null', null],
    ['a negative number', -1],
    ['a fraction', 2.5],
    ['an object', { n: 3 }],
    ['NaN-like text', 'abc'],
    ['an absurdly large number', 1e9],
  ])('rejects %s as a limit value', (_label, value) => {
    expect(parseLimitConfig(CONFIG_ROWS.map((row) => (row.key === 'free_food_logs_per_day' ? { ...row, value } : row)))).toEqual({
      ok: false,
      key: 'free_food_logs_per_day',
    });
  });

  it('accepts zero (a limit of none)', () => {
    expect(config({ free_ai_messages_per_day: 0 }).freeAiMessagesPerDay).toBe(0);
  });
});

describe('UTC quota day and reset', () => {
  it('uses the UTC date and resets at the next 00:00 UTC', () => {
    const now = new Date('2026-10-14T23:59:59.999Z');

    expect(quotaDayUtc(now)).toBe('2026-10-14');
    expect(nextResetUtc(now)).toBe('2026-10-15T00:00:00.000Z');
  });

  it('rolls over exactly at midnight UTC', () => {
    const now = new Date('2026-10-15T00:00:00.000Z');

    expect(quotaDayUtc(now)).toBe('2026-10-15');
    expect(nextResetUtc(now)).toBe('2026-10-16T00:00:00.000Z');
  });

  it('crosses month and year ends', () => {
    expect(nextResetUtc(new Date('2026-12-31T12:00:00Z'))).toBe('2027-01-01T00:00:00.000Z');
    expect(nextResetUtc(new Date('2027-02-28T00:00:01Z'))).toBe('2027-03-01T00:00:00.000Z');
  });

  it('is not shifted by the device or server time zone (a late local evening is still the same UTC day)', () => {
    expect(quotaDayUtc(new Date('2026-10-14T17:30:00-08:00'))).toBe('2026-10-15');
  });
});

describe('buildLimitSnapshot', () => {
  const now = new Date('2026-10-14T10:00:00Z');
  const base = { tier: 'free' as const, now, config: config(), foodUsed: 0, aiUsed: 0, foodCredits: 0, aiCredits: 0, adsUsed: 0 };

  it('gives a free user the configured allowances and the reset time', () => {
    expect(buildLimitSnapshot(base)).toEqual({
      tier: 'free',
      quotaDayUtc: '2026-10-14',
      resetsAt: '2026-10-15T00:00:00.000Z',
      planDaysAccessible: 14,
      food: { used: 0, base: 3, bonus: 0, remaining: 3 },
      ai: { used: 0, base: 1, bonus: 0, remaining: 1 },
      adRewards: { used: 0, max: 3, remaining: 3 },
      capabilities: { basicPlan: true, manualFood: true, adaptiveProgression: false, mealPlanner: false, photoFood: false, coach: true },
    });
  });

  describe('capabilities', () => {
    it('gives every paid feature to premium and none to free', () => {
      const premium = buildLimitSnapshot({ ...base, tier: 'premium' });
      const free = buildLimitSnapshot(base);

      expect(premium.capabilities).toEqual({ basicPlan: true, manualFood: true, adaptiveProgression: true, mealPlanner: true, photoFood: true, coach: true });
      expect([free.capabilities.adaptiveProgression, free.capabilities.mealPlanner, free.capabilities.photoFood]).toEqual([false, false, false]);
    });

    it('with the manual-food switch on, a free user has unlimited manual food, whatever was logged', () => {
      const snapshot = buildLimitSnapshot({ ...base, config: config({ manual_food_unlimited: true }), foodUsed: 40, foodCredits: 2 });

      expect(snapshot.food).toEqual({ used: 40, base: null, bonus: 2, remaining: null });
      expect(snapshot.capabilities.manualFood).toBe(true);
    });

    it('with the switch off, manual food follows the old limit and closes at zero remaining', () => {
      const snapshot = buildLimitSnapshot({ ...base, foodUsed: 3 });

      expect(snapshot.food.remaining).toBe(0);
      expect(snapshot.capabilities.manualFood).toBe(false);
    });

    it('the AI allowance still limits the coach for a free user, and the switch does not change it', () => {
      const out = buildLimitSnapshot({ ...base, config: config({ manual_food_unlimited: true }), aiUsed: 1 });

      expect(out.ai.remaining).toBe(0);
      expect(out.capabilities.coach).toBe(false);
    });

    it('a free user can open all 120 plan days when the server allows it, and basic plan stays on', () => {
      const out = buildLimitSnapshot({ ...base, config: config({ free_plan_days: 120 }) });

      expect(out.planDaysAccessible).toBe(120);
      expect(out.capabilities.basicPlan).toBe(true);
    });

    it('turns the basic plan off if the server allows no days (fail closed, never open)', () => {
      expect(buildLimitSnapshot({ ...base, config: config({ free_plan_days: 0 }) }).capabilities.basicPlan).toBe(false);
    });

    it('keeps every old field, so an older app still parses the response', () => {
      const out = buildLimitSnapshot(base) as unknown as Record<string, unknown>;

      for (const field of ['tier', 'quotaDayUtc', 'resetsAt', 'planDaysAccessible', 'food', 'ai', 'adRewards']) expect(out).toHaveProperty(field);
    });
  });

  it('adds verified ad credits to the allowance and subtracts use', () => {
    const snapshot = buildLimitSnapshot({ ...base, foodUsed: 4, foodCredits: 2, aiUsed: 1, aiCredits: 1, adsUsed: 2 });

    expect(snapshot.food).toEqual({ used: 4, base: 3, bonus: 2, remaining: 1 });
    expect(snapshot.ai).toEqual({ used: 1, base: 1, bonus: 1, remaining: 1 });
    expect(snapshot.adRewards).toEqual({ used: 2, max: 3, remaining: 1 });
  });

  it('never reports a negative remaining (for example after a limit is lowered)', () => {
    const snapshot = buildLimitSnapshot({ ...base, foodUsed: 9, adsUsed: 7 });

    expect(snapshot.food.remaining).toBe(0);
    expect(snapshot.adRewards.remaining).toBe(0);
  });

  it('shows premium as unlimited with all 120 plan days and no ad rewards', () => {
    const snapshot = buildLimitSnapshot({ ...base, tier: 'premium', foodUsed: 50, foodCredits: 4, adsUsed: 1 });

    expect(snapshot).toMatchObject({
      tier: 'premium',
      planDaysAccessible: 120,
      food: { used: 50, base: null, bonus: 0, remaining: null },
      ai: { base: null, remaining: null },
      adRewards: { used: 0, max: 0, remaining: 0 },
    });
  });

  it('follows a changed plan-day limit, capped at the 120-day plan', () => {
    expect(buildLimitSnapshot({ ...base, config: config({ free_plan_days: 20 }) }).planDaysAccessible).toBe(20);
    expect(buildLimitSnapshot({ ...base, config: config({ free_plan_days: 500 }) }).planDaysAccessible).toBe(120);
  });

  it('uses the supplied clock for the quota day (UTC rollover)', () => {
    const late = buildLimitSnapshot({ ...base, now: new Date('2026-10-14T23:59:59Z') });
    const early = buildLimitSnapshot({ ...base, now: new Date('2026-10-15T00:00:00Z') });

    expect([late.quotaDayUtc, early.quotaDayUtc]).toEqual(['2026-10-14', '2026-10-15']);
  });
});

describe('check-limit and the free plan-day lock (live)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  const users: TestUser[] = [];
  let sharedFoodId: string;
  const utcToday = () => new Date().toISOString().slice(0, 10);
  const tomorrowUtc = () => new Date(new Date(`${utcToday()}T00:00:00Z`).getTime() + 86400000).toISOString();

  beforeAll(async () => {
    sharedFoodId = (
      await admin
        .from('foods')
        .insert({ name: `Limit shared ${suffix}`, serving_desc: '1', calories: 100, protein_g: 5, carbs_g: 15, fat_g: 2, user_id: null, source: 'usda', verified: false, source_id: `limit-${suffix}` })
        .select('id')
        .single()
    ).data!.id;
  });

  afterAll(async () => {
    await admin.from('ad_credits').delete().in('user_id', users.map((u) => u.id));
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
    if (sharedFoodId) await admin.from('foods').delete().eq('id', sharedFoodId);
  });

  const freshUser = async (label = 'limit') => {
    const user = await createTestUser(admin, label);
    users.push(user);
    return user;
  };
  const makePremium = (user: TestUser) => admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id);
  const makeFree = (user: TestUser) => admin.from('entitlements').update({ tier: 'free' }).eq('user_id', user.id);
  const logFood = (user: TestUser) =>
    user.client.from('food_logs').insert({ id: crypto.randomUUID(), user_id: user.id, log_date: utcToday(), food_id: sharedFoodId, quantity: 1, meal_type: 'lunch' });
  const withPlan = async (user: TestUser) => {
    await admin
      .from('profiles')
      .update({ age: 30, height_cm: 175, weight_kg: 70, goal: 'recomp', training_level: 'beginner', equipment: 'gym', energy_sex: 'male', activity_level: 'light', onboarded_at: new Date().toISOString() })
      .eq('id', user.id);
    const { status, json } = await callFunction('generate-plan', user.jwt, { startDate: utcToday() });
    expect(status).toBe(200);
    return json.planId as string;
  };
  const visibleDays = async (user: TestUser, planId: string) =>
    ((await user.client.from('plan_days').select('day_number').eq('plan_id', planId).order('day_number')).data ?? []).map((d) => d.day_number as number);

  describe('check-limit', () => {
    it('returns 401 without a JWT', async () => {
      expect((await callFunction('check-limit', undefined, {})).status).toBe(401);
    });

    it('returns a free user the server allowances, the reset time and 14 accessible plan days', async () => {
      const user = await freshUser();

      const { status, json } = await callFunction('check-limit', user.jwt, {});

      expect(status).toBe(200);
      expect(json).toEqual({
        tier: 'free',
        quotaDayUtc: utcToday(),
        resetsAt: tomorrowUtc(),
        planDaysAccessible: 14,
        food: { used: 0, base: 3, bonus: 0, remaining: 3 },
        ai: { used: 0, base: 1, bonus: 0, remaining: 1 },
        adRewards: { used: 0, max: 3, remaining: 3 },
        capabilities: { basicPlan: true, manualFood: true, adaptiveProgression: false, mealPlanner: false, photoFood: false, coach: true },
      });
    });

    it('counts food logs used today and verified ad credits', async () => {
      const user = await freshUser();
      await logFood(user);
      await logFood(user);
      await admin.from('ad_credits').insert([
        { user_id: user.id, reward_type: 'food', credits: 2, quota_day: utcToday() },
        { user_id: user.id, reward_type: 'ai', credits: 1, quota_day: utcToday() },
        { user_id: user.id, reward_type: 'food', credits: 2, quota_day: '2020-01-01' },
      ]);

      const { json } = await callFunction('check-limit', user.jwt, {});

      expect(json.food).toEqual({ used: 2, base: 3, bonus: 2, remaining: 3 });
      expect(json.ai).toEqual({ used: 0, base: 1, bonus: 1, remaining: 2 });
      expect(json.adRewards).toEqual({ used: 2, max: 3, remaining: 1 });
    });

    it('stops offering ads after the daily reward cap', async () => {
      const user = await freshUser();
      await admin.from('ad_credits').insert([1, 2, 3].map(() => ({ user_id: user.id, reward_type: 'food', credits: 2, quota_day: utcToday() })));

      const { json } = await callFunction('check-limit', user.jwt, {});

      expect(json.adRewards).toEqual({ used: 3, max: 3, remaining: 0 });
    });

    it('shows premium as unlimited with 120 plan days and no ad rewards', async () => {
      const user = await freshUser();
      await makePremium(user);

      const { json } = await callFunction('check-limit', user.jwt, {});

      expect(json).toMatchObject({
        tier: 'premium',
        planDaysAccessible: 120,
        food: { base: null, remaining: null },
        ai: { base: null, remaining: null },
        adRewards: { used: 0, max: 0, remaining: 0 },
      });
    });

    it('follows a changed server limit', async () => {
      const user = await freshUser();
      const original = (await admin.from('app_config').select('value').eq('key', 'free_plan_days').single()).data?.value;
      await admin.from('app_config').update({ value: 20 }).eq('key', 'free_plan_days');
      try {
        expect((await callFunction('check-limit', user.jwt, {})).json.planDaysAccessible).toBe(20);
      } finally {
        await admin.from('app_config').update({ value: original }).eq('key', 'free_plan_days');
      }
    });

    it("reports only the caller's own usage and ignores a user id in the body", async () => {
      const a = await freshUser('limit-a');
      const b = await freshUser('limit-b');
      await logFood(b);
      await logFood(b);

      const { json } = await callFunction('check-limit', a.jwt, { userId: b.id });

      expect(json.food.used).toBe(0);
    });

    it('reflects the quota the database enforces: remaining reaches 0 at the limit', async () => {
      const user = await freshUser();
      for (let i = 0; i < 3; i++) expect((await logFood(user)).error).toBeNull();

      const { json } = await callFunction('check-limit', user.jwt, {});

      expect(json.food).toEqual({ used: 3, base: 3, bonus: 0, remaining: 0 });
    });
  });

  describe('free core and premium capabilities (live)', () => {
    const setConfig = (key: string, value: unknown) => admin.from('app_config').update({ value }).eq('key', key);
    const readConfig = async (key: string) => (await admin.from('app_config').select('value').eq('key', key).single()).data?.value;
    const withConfig = async (changes: Record<string, unknown>, run: () => Promise<void>) => {
      const original: Record<string, unknown> = {};
      for (const key of Object.keys(changes)) original[key] = await readConfig(key);
      try {
        for (const [key, value] of Object.entries(changes)) await setConfig(key, value);
        await run();
      } finally {
        for (const [key, value] of Object.entries(original)) await setConfig(key, value);
      }
    };

    it('ships with the switch present and off, so nothing changes until the owner turns the new policy on', async () => {
      expect(await readConfig('manual_food_unlimited')).toBe(false);
    });

    it('with the switch on, a free user can log more than the old limit and check-limit says unlimited', async () => {
      const user = await freshUser();
      await withConfig({ manual_food_unlimited: true }, async () => {
        for (let i = 0; i < 6; i++) expect((await logFood(user)).error).toBeNull();

        const { json } = await callFunction('check-limit', user.jwt, {});

        expect(json.food).toMatchObject({ used: 6, base: null, remaining: null });
        expect(json.capabilities).toMatchObject({ manualFood: true, mealPlanner: false });
      });
    });

    it('with the switch on, resending a log id is still accepted and spends nothing', async () => {
      const user = await freshUser();
      await withConfig({ manual_food_unlimited: true }, async () => {
        const id = crypto.randomUUID();
        const row = { id, user_id: user.id, log_date: utcToday(), food_id: sharedFoodId, quantity: 1, meal_type: 'lunch' };
        expect((await user.client.from('food_logs').upsert(row, { onConflict: 'id' })).error).toBeNull();
        expect((await user.client.from('food_logs').upsert(row, { onConflict: 'id' })).error).toBeNull();

        expect((await user.client.from('food_logs').select('id').eq('id', id)).data).toHaveLength(1);
      });
    });

    it("with the switch on, logging another account's private food is still refused", async () => {
      const user = await freshUser();
      const other = await freshUser('limit-other');
      const privateFood = (
        await admin
          .from('foods')
          .insert({ name: `Private ${suffix}`, serving_desc: '1', calories: 100, protein_g: 5, carbs_g: 15, fat_g: 2, user_id: other.id, source: 'custom', verified: false })
          .select('id')
          .single()
      ).data!.id;
      await withConfig({ manual_food_unlimited: true }, async () => {
        const result = await user.client
          .from('food_logs')
          .insert({ id: crypto.randomUUID(), user_id: user.id, log_date: utcToday(), food_id: privateFood, quantity: 1, meal_type: 'lunch' });

        expect(result.error).not.toBeNull();
      });
    });

    it('with free_plan_days at 120 a free user sees all 120 days and still no day 121', async () => {
      const user = await freshUser();
      const planId = await withPlan(user);
      await withConfig({ free_plan_days: 120 }, async () => {
        const days = await visibleDays(user, planId);

        expect(days).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
        expect((await user.client.from('plan_days').select('day_number').eq('plan_id', planId).eq('day_number', 121)).data ?? []).toEqual([]);
        expect((await callFunction('check-limit', user.jwt, {})).json.planDaysAccessible).toBe(120);
      });
    });

    it('paid capabilities follow the premium tier and leave the free core alone when it ends', async () => {
      const user = await freshUser();
      await makePremium(user);
      expect((await callFunction('check-limit', user.jwt, {})).json.capabilities).toEqual({ basicPlan: true, manualFood: true, adaptiveProgression: true, mealPlanner: true, photoFood: true, coach: true });

      await makeFree(user);
      const { json } = await callFunction('check-limit', user.jwt, {});

      expect(json.capabilities).toMatchObject({ basicPlan: true, manualFood: true, adaptiveProgression: false, mealPlanner: false, photoFood: false });
    });

    it('stops issuing food ad rewards when manual food is unlimited, keeps AI rewards, and issues food ones again when the switch is off', async () => {
      const user = await freshUser();
      expect((await callFunction('request-ad-reward', user.jwt, { rewardType: 'food' })).status).toBe(200);
      await withConfig({ manual_food_unlimited: true }, async () => {
        const food = await callFunction('request-ad-reward', user.jwt, { rewardType: 'food' });
        const ai = await callFunction('request-ad-reward', user.jwt, { rewardType: 'ai' });

        expect(food.status).toBe(409);
        expect(food.json).toMatchObject({ error: 'reward_unavailable' });
        expect(ai.status).toBe(200);
      });
    });

    it('keeps credits that were already earned, so nothing is lost when the policy changes', async () => {
      const user = await freshUser();
      await admin.from('ad_credits').insert({ user_id: user.id, reward_type: 'food', credits: 2, quota_day: utcToday() });
      await withConfig({ manual_food_unlimited: true }, async () => {
        const { json } = await callFunction('check-limit', user.jwt, {});

        expect(json.food.bonus).toBe(2);
      });
      expect((await admin.from('ad_credits').select('id').eq('user_id', user.id)).data).toHaveLength(1);
    });
  });

  describe('free plan-day lock through the Data API', () => {
    it('shows a free user days 1 to 14 and hides day 15 onward, while the plan stays intact', async () => {
      const user = await freshUser();
      const planId = await withPlan(user);

      const days = await visibleDays(user, planId);
      const locked = await user.client.from('plan_days').select('day_number').eq('plan_id', planId).gte('day_number', 15);
      const day15 = await user.client.from('plan_days').select('day_number, workout').eq('plan_id', planId).eq('day_number', 15);
      const counted = await user.client.from('plan_days').select('*', { count: 'exact', head: true }).eq('plan_id', planId);

      expect(days).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
      expect(locked.data ?? []).toEqual([]);
      expect(day15.data ?? []).toEqual([]);
      expect(counted.count).toBe(14);
      expect((await user.client.from('plans').select('id').eq('id', planId)).data).toHaveLength(1);
      expect((await admin.from('plan_days').select('day_number').eq('plan_id', planId)).data).toHaveLength(120);
    });

    it('lets a premium user read the full 120-day plan, and locks again if premium ends', async () => {
      const user = await freshUser();
      const planId = await withPlan(user);

      await makePremium(user);
      expect(await visibleDays(user, planId)).toHaveLength(120);

      await makeFree(user);
      expect(await visibleDays(user, planId)).toHaveLength(14);
    });

    it('follows the configured free plan days', async () => {
      const user = await freshUser();
      const planId = await withPlan(user);
      const original = (await admin.from('app_config').select('value').eq('key', 'free_plan_days').single()).data?.value;
      await admin.from('app_config').update({ value: 20 }).eq('key', 'free_plan_days');
      try {
        expect(await visibleDays(user, planId)).toHaveLength(20);
      } finally {
        await admin.from('app_config').update({ value: original }).eq('key', 'free_plan_days');
      }
    });

    it("still hides another user's plan days from everyone, premium included", async () => {
      const owner = await freshUser('plan-owner');
      const planId = await withPlan(owner);
      const other = await freshUser('plan-other');
      await makePremium(other);

      expect(await visibleDays(other, planId)).toEqual([]);
    });

    it('does not let a user change their own tier or the limit config to unlock days', async () => {
      const user = await freshUser();
      const planId = await withPlan(user);

      const tier = await user.client.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id).select();
      const config = await user.client.from('app_config').update({ value: 120 }).eq('key', 'free_plan_days').select();

      expect(tier.data ?? []).toEqual([]);
      expect(config.data ?? []).toEqual([]);
      expect(await visibleDays(user, planId)).toHaveLength(14);
    });

    it('keeps plan days read-only for the owner', async () => {
      const user = await freshUser();
      const planId = await withPlan(user);

      const update = await user.client.from('plan_days').update({ calorie_target: 9999 }).eq('plan_id', planId).select();

      expect(update.data ?? []).toEqual([]);
    });
  });
});
