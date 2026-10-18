import { callFunction, createAdmin, createTestUser, TestUser } from './helpers';
import { buildPlanDays, NUTRITION_RULES } from '../functions/_shared/plan/generate';
import { loadCoachContext } from '../functions/_shared/coach/context';

jest.setTimeout(300000);

const utcDate = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const REQUEST = () => crypto.randomUUID();

// Roadmap B3: more than one plan per account. The first cycle finishes, the next one starts atomically, nothing
// from the earlier cycle is lost, and every place that used to assume "the plan" reads the active one.
describe('plan cycles (live)', () => {
  const admin = createAdmin();
  const users: TestUser[] = [];
  let exercises: { id: string; name: string; muscle_group: string; equipment: string; instructions: string }[] = [];
  const profile = { age: 30, height_cm: 175, weight_kg: 70, goal: 'lose_fat', training_level: 'beginner', equipment: 'gym', energy_sex: 'male', activity_level: 'light' };

  beforeAll(async () => {
    exercises = (await admin.from('exercises').select('id, name, muscle_group, equipment, instructions')).data ?? [];
  });
  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });

  const freshUser = async (label = 'cycle') => {
    const user = await createTestUser(admin, label);
    users.push(user);
    await admin.from('profiles').update({ ...profile, onboarded_at: new Date().toISOString() }).eq('id', user.id);
    return user;
  };

  // A first cycle that began `daysAgo` days ago, made the way the server makes one (without the start-date window
  // the public endpoint applies to brand-new plans).
  const firstPlan = async (user: TestUser, daysAgo: number) => {
    const start = utcDate(-daysAgo);
    const days = buildPlanDays(
      { age: 30, heightCm: 175, weightKg: 70, goal: 'lose_fat', trainingLevel: 'beginner', equipment: 'gym', energySex: 'male', activityLevel: 'light' },
      start,
      exercises,
      NUTRITION_RULES
    ).map(({ date: _date, ...day }) => day);
    const { data, error } = await admin.rpc('create_plan_with_days', { p_user_id: user.id, p_start_date: start, p_days: days });
    expect(error).toBeNull();
    return { planId: data[0].result_plan_id as string, start };
  };
  const startCycle = (user: TestUser, body: Record<string, unknown> = {}) =>
    callFunction('start-next-cycle', user.jwt, { requestId: REQUEST(), mode: 'progression', startDate: utcDate(0), ...body });
  const plansOf = async (user: TestUser) => (await admin.from('plans').select('id, status, cycle_number, mode, completed_at, start_date').eq('user_id', user.id).order('cycle_number')).data ?? [];

  describe('the endpoint', () => {
    it('answers 401 without a JWT and 400 for a bad body', async () => {
      const user = await freshUser();
      await firstPlan(user, 130);

      expect((await callFunction('start-next-cycle', undefined, {})).status).toBe(401);
      expect((await startCycle(user, { mode: 'initial' })).status).toBe(400);
      expect((await startCycle(user, { requestId: 'nope' })).status).toBe(400);
      expect((await startCycle(user, { startDate: 'tomorrow' })).status).toBe(400);
      expect(await plansOf(user)).toHaveLength(1);
    });

    it('refuses while the current cycle is not finished, and changes nothing', async () => {
      const user = await freshUser();
      await firstPlan(user, 50);

      const result = await startCycle(user);

      expect(result.status).toBe(409);
      expect(result.json).toMatchObject({ error: 'CYCLE_NOT_FINISHED' });
      expect(await plansOf(user)).toMatchObject([{ status: 'active', cycle_number: 1 }]);
    });

    it('is not allowed on the last day itself: the next cycle starts after day 120', async () => {
      const user = await freshUser();
      await firstPlan(user, 119); // today is day 120

      expect((await startCycle(user)).status).toBe(409);
    });

    it('starts cycle 2 once day 120 has passed: the old cycle is completed, the new one active with 120 days', async () => {
      const user = await freshUser();
      const first = await firstPlan(user, 120); // today is day 121

      const result = await startCycle(user, { mode: 'maintenance' });

      expect(result.status).toBe(200);
      expect(result.json).toMatchObject({ created: true, cycleNumber: 2 });
      const plans = await plansOf(user);
      expect(plans).toHaveLength(2);
      expect(plans[0]).toMatchObject({ id: first.planId, status: 'completed', cycle_number: 1 });
      expect(plans[0].completed_at).not.toBeNull();
      expect(plans[1]).toMatchObject({ id: result.json.planId, status: 'active', cycle_number: 2, mode: 'maintenance', start_date: utcDate(0) });
      const days = (await admin.from('plan_days').select('day_number').eq('plan_id', result.json.planId)).data ?? [];
      expect(days).toHaveLength(120);
    });

    it('plans maintenance calories for a maintenance cycle and keeps the goal\'s calories for a progression cycle', async () => {
      const a = await freshUser('cycle-a');
      const b = await freshUser('cycle-b');
      await firstPlan(a, 125);
      await firstPlan(b, 125);

      const maintenance = await startCycle(a, { mode: 'maintenance' });
      const progression = await startCycle(b, { mode: 'progression' });

      const target = async (planId: string) => (await admin.from('plan_days').select('calorie_target').eq('plan_id', planId).eq('day_number', 1).single()).data?.calorie_target as number;
      expect(await target(maintenance.json.planId)).toBeGreaterThan(await target(progression.json.planId)); // lose_fat is below maintenance
    });

    it('answers the same cycle to a repeat of the same request, and does not create a third', async () => {
      const user = await freshUser();
      await firstPlan(user, 125);
      const requestId = REQUEST();

      const first = await startCycle(user, { requestId });
      const again = await startCycle(user, { requestId });

      expect(first.json).toMatchObject({ created: true });
      expect(again.status).toBe(200);
      expect(again.json).toMatchObject({ created: false, planId: first.json.planId, cycleNumber: 2 });
      expect(await plansOf(user)).toHaveLength(2);
    });

    it('creates exactly one cycle when the same request arrives many times at once', async () => {
      const user = await freshUser();
      await firstPlan(user, 125);
      const requestId = REQUEST();

      const results = await Promise.all(Array.from({ length: 5 }, () => startCycle(user, { requestId })));

      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(new Set(results.map((r) => r.json.planId)).size).toBe(1);
      expect(results.filter((r) => r.json.created === true)).toHaveLength(1);
      expect(await plansOf(user)).toHaveLength(2);
    });

    it('lets exactly one of several different requests start the next cycle; the rest are refused', async () => {
      const user = await freshUser();
      await firstPlan(user, 125);

      const results = await Promise.all(Array.from({ length: 4 }, () => startCycle(user)));

      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      const plans = await plansOf(user);
      expect(plans.map((p) => p.status)).toEqual(['completed', 'active']);
    });

    it('does not touch the earlier cycle\'s logs, check-ins or days', async () => {
      const user = await freshUser();
      const first = await firstPlan(user, 125);
      const exerciseId = exercises[0].id;
      await admin.from('workout_logs').insert({ user_id: user.id, log_date: utcDate(-100), exercise_id: exerciseId, set_number: 1, reps: 8, weight_kg: 20 });
      await admin.from('checkins').insert({ user_id: user.id, checkin_date: utcDate(-100), weight_kg: 70 });
      const before = {
        logs: (await admin.from('workout_logs').select('id, log_date, reps').eq('user_id', user.id)).data,
        checkins: (await admin.from('checkins').select('id, checkin_date, weight_kg').eq('user_id', user.id)).data,
        days: (await admin.from('plan_days').select('day_number, workout, calorie_target').eq('plan_id', first.planId).order('day_number')).data,
      };

      expect((await startCycle(user)).status).toBe(200);

      expect((await admin.from('workout_logs').select('id, log_date, reps').eq('user_id', user.id)).data).toEqual(before.logs);
      expect((await admin.from('checkins').select('id, checkin_date, weight_kg').eq('user_id', user.id)).data).toEqual(before.checkins);
      expect((await admin.from('plan_days').select('day_number, workout, calorie_target').eq('plan_id', first.planId).order('day_number')).data).toEqual(before.days);
    });

    it('never lets another account use or learn about this account\'s cycle', async () => {
      const a = await freshUser('cycle-a');
      const b = await freshUser('cycle-b');
      await firstPlan(a, 125);
      const requestId = REQUEST();

      const asB = await startCycle(b, { requestId }); // B has no plan at all
      const asA = await startCycle(a, { requestId });

      expect(asB.status).toBe(404);
      expect(asB.json).toMatchObject({ error: 'NO_ACTIVE_PLAN' });
      expect(asA.status).toBe(200);
      expect((await plansOf(b))).toHaveLength(0);
      expect((await b.client.from('plans').select('id').eq('user_id', a.id)).data ?? []).toEqual([]);
    });

    it('ignores a user id in the body and uses the one in the token', async () => {
      const a = await freshUser('cycle-a');
      const b = await freshUser('cycle-b');
      await firstPlan(a, 125);

      const result = await startCycle(b, { userId: a.id });

      expect(result.status).toBe(404);
      expect(await plansOf(a)).toHaveLength(1);
    });
  });

  describe('the database', () => {
    it('rolls back completely when the new days are wrong: the old cycle stays active and no new plan exists', async () => {
      const user = await freshUser();
      await firstPlan(user, 125);

      const { error } = await admin.rpc('start_next_cycle', {
        p_user_id: user.id,
        p_request_id: REQUEST(),
        p_mode: 'progression',
        p_start_date: utcDate(0),
        p_days: [{ day_number: 1 }],
        p_journey_time_zone: null,
      });

      expect(error).not.toBeNull();
      expect(await plansOf(user)).toMatchObject([{ status: 'active', cycle_number: 1 }]);
    });

    it('allows only one active plan per account, even for the service role', async () => {
      const user = await freshUser();
      await firstPlan(user, 125);

      const second = await admin.from('plans').insert({ user_id: user.id, start_date: utcDate(0), cycle_number: 2, status: 'active' });

      expect(second.error).not.toBeNull();
    });

    it('allows only one plan per account and cycle number', async () => {
      const user = await freshUser();
      await firstPlan(user, 125);

      const duplicate = await admin.from('plans').insert({ user_id: user.id, start_date: utcDate(-300), cycle_number: 1, status: 'completed' });

      expect(duplicate.error).not.toBeNull();
    });

    it('cannot be called by a signed-in app user directly', async () => {
      const user = await freshUser();
      await firstPlan(user, 125);

      const attempt = await user.client.rpc('start_next_cycle', { p_user_id: user.id, p_request_id: REQUEST(), p_mode: 'progression', p_start_date: utcDate(0), p_days: [], p_journey_time_zone: null });

      expect(attempt.error).not.toBeNull();
      expect(await plansOf(user)).toHaveLength(1);
    });

    it('lets the member read all their own cycles and no one else\'s', async () => {
      const a = await freshUser('cycle-a');
      const b = await freshUser('cycle-b');
      await firstPlan(a, 125);
      await startCycle(a);

      expect((await a.client.from('plans').select('id, cycle_number').order('cycle_number')).data).toHaveLength(2);
      expect((await b.client.from('plans').select('id')).data ?? []).toEqual([]);
    });

    it('removes every cycle and its days with the account', async () => {
      const user = await freshUser();
      await firstPlan(user, 125);
      await startCycle(user);
      expect(await plansOf(user)).toHaveLength(2);

      await admin.auth.admin.deleteUser(user.id);

      expect(await plansOf(user)).toHaveLength(0);
      expect((await admin.from('plan_days').select('id').eq('user_id', user.id)).data ?? []).toHaveLength(0);
      users.splice(users.indexOf(user), 1);
    });
  });

  describe('everything that used to assume one plan', () => {
    it('generate-plan returns the active cycle and never creates another', async () => {
      const user = await freshUser();
      await firstPlan(user, 125);
      const cycle2 = (await startCycle(user)).json.planId as string;

      const again = await callFunction('generate-plan', user.jwt, { startDate: utcDate(0) });

      expect(again.status).toBe(200);
      expect(again.json).toMatchObject({ planId: cycle2, created: false });
      expect(await plansOf(user)).toHaveLength(2);
    });

    it('the coach reads the active cycle, not the finished one', async () => {
      const user = await freshUser();
      await firstPlan(user, 125);
      await startCycle(user); // cycle 2 starts today, so today is its day 1

      const context = await loadCoachContext(admin, user.id);

      expect(context.todayDayNumber).toBe(1);
      expect(context.planDays.length).toBeGreaterThan(0);
      expect(context.planDays[0].dayNumber).toBe(3);
    });

    it('accepting a coach proposal changes the days of the active cycle and leaves the finished cycle alone', async () => {
      const user = await freshUser();
      const first = await firstPlan(user, 125);
      const cycle2 = (await startCycle(user)).json.planId as string;
      await admin.from('plans').update({ start_date: utcDate(-2) }).eq('id', cycle2); // today is day 3, so day 5 is editable
      const day5 = (await admin.from('plan_days').select('workout, calorie_target, protein_target_g').eq('plan_id', cycle2).eq('day_number', 5).single()).data!;
      const oldDay5 = (await admin.from('plan_days').select('calorie_target').eq('plan_id', first.planId).eq('day_number', 5).single()).data!;
      const requestId = REQUEST();
      const base = { user_id: user.id, request_id: requestId };
      await admin.from('coach_requests').insert({ ...base, quota_day: utcDate(0), status: 'completed', lease_until: new Date().toISOString(), completed_at: new Date().toISOString() });
      await admin.from('coach_messages').insert({ ...base, message: 'a question', reply: 'a reply', language: 'en' });
      const patch = { patches: [{ dayNumber: 5, next: { calorieTarget: day5.calorie_target + 100 }, expected: { workout: day5.workout, calorieTarget: day5.calorie_target, proteinTargetG: day5.protein_target_g } }] };
      const proposal = (await admin.from('coach_proposals').insert({ ...base, patch, status: 'pending' }).select('id').single()).data!.id;

      const { data, error } = await admin.rpc('coach_decide_proposal', { p_user_id: user.id, p_proposal_id: proposal, p_decision: 'accept' });

      expect(error).toBeNull();
      expect(data).toMatchObject({ status: 'accepted', changed_days: [5] });
      expect((await admin.from('plan_days').select('calorie_target').eq('plan_id', cycle2).eq('day_number', 5).single()).data?.calorie_target).toBe(day5.calorie_target + 100);
      expect((await admin.from('plan_days').select('calorie_target').eq('plan_id', first.planId).eq('day_number', 5).single()).data?.calorie_target).toBe(oldDay5.calorie_target);
    });
  });
});
