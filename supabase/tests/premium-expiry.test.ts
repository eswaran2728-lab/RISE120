import { createAdmin, createTestUser, callFunction, TestUser } from './helpers';

jest.setTimeout(240000);

const utcToday = () => new Date().toISOString().slice(0, 10);
const DAY = 86400000;

// entitlements.tier is only moved by webhook events. A subscription that lapses without an event leaves the
// tier stale, so every access gate must also compare the stored expiry with server time.
describe('premium expiry is enforced by every access gate (live)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  let user: TestUser;
  let planId: string;
  let sharedFoodId: string;

  beforeAll(async () => {
    sharedFoodId = (
      await admin
        .from('foods')
        .insert({ name: `Expiry shared ${suffix}`, serving_desc: '1', calories: 100, protein_g: 5, carbs_g: 15, fat_g: 2, user_id: null, source: 'usda', verified: false, source_id: `expiry-${suffix}` })
        .select('id')
        .single()
    ).data!.id;
    user = await createTestUser(admin, 'expiry');
    planId = await withPlan(user);
  });
  beforeEach(async () => {
    await admin.from('food_logs').delete().eq('user_id', user.id);
    await admin.from('billing_state').delete().eq('user_id', user.id);
    await admin.from('entitlements').update({ tier: 'free', source: null }).eq('user_id', user.id);
  });
  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
    if (sharedFoodId) await admin.from('foods').delete().eq('id', sharedFoodId);
  });

  // Stored state as the webhook would leave it: tier says premium and billing_state holds the expiry.
  const subscribe = async (u: TestUser, untilMs: number | null) => {
    expect((await admin.from('entitlements').update({ tier: 'premium', source: 'revenuecat' }).eq('user_id', u.id)).error).toBeNull();
    expect((await admin.from('billing_state').upsert({ user_id: u.id, last_event_ms: 1, premium_active: true, premium_until_ms: untilMs })).error).toBeNull();
  };
  const logFood = (u: TestUser) =>
    u.client.from('food_logs').insert({ id: crypto.randomUUID(), user_id: u.id, log_date: utcToday(), food_id: sharedFoodId, quantity: 1, meal_type: 'lunch' });
  const withPlan = async (u: TestUser) => {
    await admin
      .from('profiles')
      .update({ age: 30, height_cm: 175, weight_kg: 70, goal: 'recomp', training_level: 'beginner', equipment: 'gym', energy_sex: 'male', activity_level: 'light', onboarded_at: new Date().toISOString() })
      .eq('id', u.id);
    const { status, json } = await callFunction('generate-plan', u.jwt, { startDate: utcToday() });
    expect(status).toBe(200);
    return json.planId as string;
  };
  const visibleDays = async (user: TestUser, planId: string) =>
    ((await user.client.from('plan_days').select('day_number').eq('plan_id', planId)).data ?? []).length;
  const snapshot = async (u: TestUser) => (await callFunction('check-limit', u.jwt, {})).json;
  const tierColumn = async (u: TestUser) => (await admin.from('entitlements').select('tier').eq('user_id', u.id).single()).data?.tier;

  describe('a subscription whose stored expiry is in the past', () => {
    it('is held to the free food limit even though the tier column still says premium', async () => {
      await subscribe(user, Date.now() - 60000);

      // The free limit is server config (another suite briefly changes it), so log until the server refuses:
      // a lapsed subscription must hit the free cap, where a real premium user never would.
      let refused: { message?: string } | null = null;
      for (let i = 0; i < 20 && !refused; i++) refused = (await logFood(user)).error;

      expect(refused?.message).toBe('FOOD_LIMIT_REACHED');
      expect(await tierColumn(user)).toBe('premium');
    });

    it('sees only the free plan days through the Data API', async () => {
      await subscribe(user, Date.now() - 60000);

      expect(await visibleDays(user, planId)).toBeLessThan(120);
    });

    it('is reported as free by check-limit', async () => {
      await subscribe(user, Date.now() - 60000);

      const json = await snapshot(user);

      // Exact limit values are other suites' business (they change app_config while running in parallel);
      // here only the tier matters: a lapsed subscription gets the limited, free-shaped answer.
      expect(json.tier).toBe('free');
      expect(json.planDaysAccessible).toBeLessThan(120);
      expect(json.food.base).not.toBeNull();
      expect(json.adRewards.max).toBeGreaterThan(0);
    });
  });

  describe('a subscription that has not expired', () => {
    it('is premium in every gate', async () => {
      await subscribe(user, Date.now() + DAY);
      for (let i = 0; i < 4; i++) expect((await logFood(user)).error).toBeNull();

      expect(await visibleDays(user, planId)).toBe(120);
      expect(await snapshot(user)).toMatchObject({ tier: 'premium', planDaysAccessible: 120, food: { base: null, remaining: null } });
    });

    it('loses access as server time passes its expiry, with no event and no write', async () => {
      await subscribe(user, Date.now() + 4000);
      expect(await visibleDays(user, planId)).toBe(120);

      await new Promise((resolve) => setTimeout(resolve, 5000));

      expect(await visibleDays(user, planId)).toBeLessThan(120);
      expect((await snapshot(user)).tier).toBe('free');
      expect(await tierColumn(user)).toBe('premium');
    });
  });

  describe('lifetime access (no expiry)', () => {
    it('stays premium in every gate', async () => {
      await subscribe(user, null);
      for (let i = 0; i < 4; i++) expect((await logFood(user)).error).toBeNull();

      expect(await visibleDays(user, planId)).toBe(120);
      expect((await snapshot(user)).tier).toBe('premium');
    });
  });

  it('keeps manually granted premium (no billing state) working', async () => {
    await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id);
    for (let i = 0; i < 4; i++) expect((await logFood(user)).error).toBeNull();

    expect((await snapshot(user)).tier).toBe('premium');
  });

  it('does not let a client call the premium helpers directly', async () => {

    expect((await user.client.rpc('is_premium_now', { p_user_id: user.id })).error).not.toBeNull();
  });
});
