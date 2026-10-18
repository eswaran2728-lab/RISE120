import { callFunction, createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(240000);

const utcToday = () => new Date().toISOString().slice(0, 10);

// Roadmap B2: lifestyle preferences and the journey time zone. The preferences belong to the member's own
// profile; none of them may change a plan target; an invalid zone or budget must be refused by the database
// itself, not only by the app.
describe('journey and lifestyle preferences (live)', () => {
  const admin = createAdmin();
  const users: TestUser[] = [];

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });

  const freshUser = async (label = 'journey') => {
    const user = await createTestUser(admin, label);
    users.push(user);
    return user;
  };
  const prefs = { region: 'MY', journey_time_zone: 'Asia/Kuala_Lumpur', cooking_access: 'basic', cooking_minutes: 20, budget_amount: 15, budget_currency: 'MYR' };
  const readPrefs = async (user: TestUser) =>
    (await user.client.from('profiles').select('region, journey_time_zone, cooking_access, cooking_minutes, budget_amount, budget_currency').eq('id', user.id).single()).data;

  it('lets a member save and read back their own preferences', async () => {
    const user = await freshUser();

    const saved = await user.client.from('profiles').update(prefs).eq('id', user.id);

    expect(saved.error).toBeNull();
    expect(await readPrefs(user)).toEqual({ ...prefs, budget_amount: 15 });
  });

  it('starts with every preference unset', async () => {
    const user = await freshUser();

    expect(await readPrefs(user)).toEqual({ region: null, journey_time_zone: null, cooking_access: null, cooking_minutes: null, budget_amount: null, budget_currency: null });
  });

  it('refuses an invalid time zone in the database, and accepts a valid one and null', async () => {
    const user = await freshUser();

    const bad = await user.client.from('profiles').update({ journey_time_zone: 'Mars/Phobos' }).eq('id', user.id);
    const good = await user.client.from('profiles').update({ journey_time_zone: 'Asia/Singapore' }).eq('id', user.id);
    const cleared = await user.client.from('profiles').update({ journey_time_zone: null }).eq('id', user.id);

    expect(bad.error?.message).toMatch(/INVALID_TIME_ZONE/);
    expect(good.error).toBeNull();
    expect(cleared.error).toBeNull();
  });

  it.each([
    ['an unknown region', { region: 'FR' }],
    ['an unknown cooking access', { cooking_access: 'chef' }],
    ['too few cooking minutes', { cooking_minutes: 2 }],
    ['too many cooking minutes', { cooking_minutes: 500 }],
    ['a negative budget', { budget_amount: -1, budget_currency: 'MYR' }],
    ['an absurd budget', { budget_amount: 1e9, budget_currency: 'MYR' }],
    ['a budget with no currency', { budget_amount: 10, budget_currency: null }],
    ['a currency with no budget', { budget_amount: null, budget_currency: 'MYR' }],
    ['an unsupported currency', { budget_amount: 10, budget_currency: 'USD' }],
  ])('refuses %s', async (_label, change) => {
    const user = await freshUser();

    const result = await user.client.from('profiles').update(change).eq('id', user.id);

    expect(result.error).not.toBeNull();
  });

  it("does not let one member change another member's preferences", async () => {
    const a = await freshUser('journey-a');
    const b = await freshUser('journey-b');
    await a.client.from('profiles').update(prefs).eq('id', a.id);

    const attempt = await b.client.from('profiles').update({ region: 'SG', budget_amount: 999, budget_currency: 'SGD' }).eq('id', a.id).select('id');

    expect(attempt.data ?? []).toEqual([]);
    expect(await readPrefs(a)).toEqual({ ...prefs, budget_amount: 15 });
  });

  it('never changes plan targets: a new budget, region or cooking time leaves every plan day alone', async () => {
    const user = await freshUser();
    await admin
      .from('profiles')
      .update({ age: 30, height_cm: 175, weight_kg: 70, goal: 'recomp', training_level: 'beginner', equipment: 'gym', energy_sex: 'male', activity_level: 'light', onboarded_at: new Date().toISOString() })
      .eq('id', user.id);
    const created = await callFunction('generate-plan', user.jwt, { startDate: utcToday() });
    expect(created.status).toBe(200);
    const targets = async () =>
      (await admin.from('plan_days').select('day_number, calorie_target, protein_target_g, workout').eq('plan_id', created.json.planId).order('day_number')).data;
    const before = await targets();

    await user.client.from('profiles').update({ ...prefs, budget_amount: 5, cooking_minutes: 240 }).eq('id', user.id);
    const again = await callFunction('generate-plan', user.jwt, { startDate: utcToday() });

    expect(again.json.planId).toBe(created.json.planId);
    expect(await targets()).toEqual(before);
  });

  it('records the zone on a plan only when valid, and existing plans keep the phone zone (null)', async () => {
    const user = await freshUser();
    await admin
      .from('profiles')
      .update({ age: 30, height_cm: 175, weight_kg: 70, goal: 'recomp', training_level: 'beginner', equipment: 'gym', energy_sex: 'male', activity_level: 'light', onboarded_at: new Date().toISOString() })
      .eq('id', user.id);
    const created = await callFunction('generate-plan', user.jwt, { startDate: utcToday() });
    const planId = created.json.planId as string;

    const initial = (await admin.from('plans').select('journey_time_zone').eq('id', planId).single()).data;
    const good = await admin.from('plans').update({ journey_time_zone: 'Asia/Kuala_Lumpur' }).eq('id', planId);
    const bad = await admin.from('plans').update({ journey_time_zone: 'Mars/Phobos' }).eq('id', planId);

    expect(initial).toEqual({ journey_time_zone: null });
    expect(good.error).toBeNull();
    expect(bad.error?.message).toMatch(/INVALID_TIME_ZONE/);
  });

  it("keeps a member from writing a plan's zone through the Data API", async () => {
    const user = await freshUser();
    await admin
      .from('profiles')
      .update({ age: 30, height_cm: 175, weight_kg: 70, goal: 'recomp', training_level: 'beginner', equipment: 'gym', energy_sex: 'male', activity_level: 'light', onboarded_at: new Date().toISOString() })
      .eq('id', user.id);
    const planId = (await callFunction('generate-plan', user.jwt, { startDate: utcToday() })).json.planId as string;

    const attempt = await user.client.from('plans').update({ journey_time_zone: 'Asia/Singapore' }).eq('id', planId).select('id');

    expect(attempt.error !== null || (attempt.data ?? []).length === 0).toBe(true);
    expect((await admin.from('plans').select('journey_time_zone').eq('id', planId).single()).data).toEqual({ journey_time_zone: null });
  });
});
