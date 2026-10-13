import { createAdmin, callFunction, createTestUser, TestUser } from './helpers';

jest.setTimeout(120000);

const today = () => new Date().toISOString().slice(0, 10);

describe('generate-plan edge function (live)', () => {
  const admin = createAdmin();
  let a: TestUser;
  let b: TestUser;
  let incomplete: TestUser;

  const completeProfile = (id: string, extra: Record<string, unknown> = {}) =>
    admin
      .from('profiles')
      .update({
        age: 30,
        height_cm: 175,
        weight_kg: 70,
        goal: 'recomp',
        training_level: 'beginner',
        equipment: 'gym',
        energy_sex: 'male',
        activity_level: 'light',
        onboarded_at: new Date().toISOString(),
        ...extra,
      })
      .eq('id', id);

  const plansOf = async (userId: string) => {
    const { data } = await admin.from('plans').select('id').eq('user_id', userId);
    return data ?? [];
  };
  const daysOf = async (planId: string) => {
    const { data } = await admin.from('plan_days').select('day_number, workout, calorie_target, protein_target_g').eq('plan_id', planId).order('day_number');
    return data ?? [];
  };

  beforeAll(async () => {
    a = await createTestUser(admin, 'plan-a');
    b = await createTestUser(admin, 'plan-b');
    incomplete = await createTestUser(admin, 'plan-incomplete');
    expect((await completeProfile(a.id)).error).toBeNull();
    expect((await completeProfile(b.id)).error).toBeNull();
  });

  afterAll(async () => {
    for (const user of [a, b, incomplete]) if (user) await admin.auth.admin.deleteUser(user.id);
  });

  it('returns 401 without a JWT', async () => {
    const { status } = await callFunction('generate-plan', undefined, { startDate: today() });

    expect(status).toBe(401);
  });

  it('rejects an incomplete profile and creates nothing', async () => {
    const { status } = await callFunction('generate-plan', incomplete.jwt, { startDate: today() });

    expect(status).toBe(422);
    expect(await plansOf(incomplete.id)).toEqual([]);
  });

  it('rejects a malformed or far-off start date', async () => {
    expect((await callFunction('generate-plan', a.jwt, { startDate: '13/10/2026' })).status).toBe(400);
    expect((await callFunction('generate-plan', a.jwt, { startDate: '2020-01-01' })).status).toBe(400);
    expect(await plansOf(a.id)).toEqual([]);
  });

  it('ignores a user id in the body and creates the plan for the JWT user only', async () => {
    const { status, json } = await callFunction('generate-plan', a.jwt, { startDate: today(), userId: b.id });

    expect(status).toBe(200);
    expect(json.created).toBe(true);
    expect(await plansOf(b.id)).toEqual([]);
    expect((await plansOf(a.id)).map((p) => p.id)).toEqual([json.planId]);
  });

  it('leaves one plan with 120 unique days after a second call', async () => {
    const first = (await plansOf(a.id))[0].id;

    const { status, json } = await callFunction('generate-plan', a.jwt, { startDate: today() });

    expect(status).toBe(200);
    expect(json).toEqual({ planId: first, created: false });
    expect(await plansOf(a.id)).toHaveLength(1);
    const days = await daysOf(first);
    expect(days).toHaveLength(120);
    expect(new Set(days.map((d) => d.day_number)).size).toBe(120);
    expect(days[0].workout).toMatchObject({ kind: 'workout' });
    expect(days[0].calorie_target).toBe(2650);
    expect(days[0].protein_target_g).toBe(125);
    expect(days[1].workout).toEqual({ kind: 'rest' });
  });

  it('repairs a partial generation on retry', async () => {
    const planId = (await plansOf(a.id))[0].id;
    await admin.from('plan_days').delete().eq('plan_id', planId).gt('day_number', 40);
    expect(await daysOf(planId)).toHaveLength(40);

    const { status, json } = await callFunction('generate-plan', a.jwt, { startDate: today() });

    expect(status).toBe(200);
    expect(json).toEqual({ planId, created: false });
    expect(await daysOf(planId)).toHaveLength(120);
  });

  it('keeps one plan with 120 days when called concurrently', async () => {
    const results = await Promise.all([1, 2, 3].map(() => callFunction('generate-plan', b.jwt, { startDate: today() })));

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.json.created).length).toBe(1);
    const plans = await plansOf(b.id);
    expect(plans).toHaveLength(1);
    expect(await daysOf(plans[0].id)).toHaveLength(120);
  });

  it('stops clients writing plans or days directly and hides other users plans', async () => {
    const planA = (await plansOf(a.id))[0].id;

    const insertPlan = await b.client.from('plans').insert({ user_id: b.id, start_date: today() });
    expect(insertPlan.error).not.toBeNull();

    const updateDay = await a.client.from('plan_days').update({ calorie_target: 9999 }).eq('plan_id', planA).select();
    expect(updateDay.data ?? []).toEqual([]);
    const deleteDay = await a.client.from('plan_days').delete().eq('plan_id', planA).select();
    expect(deleteDay.data ?? []).toEqual([]);
    expect(await daysOf(planA)).toHaveLength(120);

    const peek = await b.client.from('plans').select('id').eq('user_id', a.id);
    expect(peek.data ?? []).toEqual([]);
    const peekDays = await b.client.from('plan_days').select('id').eq('plan_id', planA);
    expect(peekDays.data ?? []).toEqual([]);

    const own = await a.client.from('plan_days').select('day_number').eq('plan_id', planA);
    expect((own.data ?? []).length).toBe(120);
  });

  it('does not allow a client to call the atomic database function directly', async () => {
    const { error } = await b.client.rpc('create_plan_with_days', { p_user_id: b.id, p_start_date: today(), p_days: [] });

    expect(error).not.toBeNull();
  });
});
