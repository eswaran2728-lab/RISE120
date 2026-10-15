import { createAdmin, createTestUser, callFunction, createTestClient, publishableKey, nodeFetch, supabaseUrl, TestUser } from './helpers';
import { loadCoachContext } from '../functions/_shared/coach/context';
import { validateCoachReply } from '../functions/_shared/coach/validate';
import type { CoachProposalPatch } from '../functions/_shared/coach/types';

jest.setTimeout(300000);

const DAY_MS = 86400000;
const uuid = () => crypto.randomUUID();
const utcDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

type Workout = { kind: 'rest' } | { kind: 'workout'; exercises: { exercise_id: string; sets: number; reps: number }[] };
type DayRow = { workout: Workout; calorie_target: number | null; protein_target_g: number | null };

// Accepting or declining a stored coach proposal. The plan is edited only by the database function, only from
// the stored patch, only if every rule still holds right now, and either wholly or not at all. Today is plan day 3
// in these tests (the plan starts two days ago), so the editable days are 5 to 14 for a free member and up to
// 17 for a premium one.
describe('coach proposal decisions (live)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  const users: TestUser[] = [];
  const planIds = new Map<string, string>();
  const original = new Map<string, Map<number, DayRow>>();
  let swapA: string; // two temporary gym exercises of a made-up pattern, so a valid swap exists
  let swapB: string;
  const seeded: Record<string, string> = {}; // pattern -> id of the seeded gym exercise
  let homeSquat: string;

  const PROFILE = {
    age: 30, height_cm: 175, weight_kg: 70, goal: 'recomp', training_level: 'beginner', equipment: 'gym', energy_sex: 'male', activity_level: 'light',
  };

  const completeProfile = (id: string, extra: Record<string, unknown> = {}) =>
    admin.from('profiles').update({ ...PROFILE, onboarded_at: new Date().toISOString(), ...extra }).eq('id', id);

  beforeAll(async () => {
    const tmp = await admin
      .from('exercises')
      .insert([
        { name: `zz-coach-swap-a-${suffix}`, muscle_group: 'testpattern', equipment: 'gym', instructions: 'temporary test exercise A' },
        { name: `zz-coach-swap-b-${suffix}`, muscle_group: 'testpattern', equipment: 'gym', instructions: 'temporary test exercise B' },
      ])
      .select('id, name');
    swapA = tmp.data!.find((r) => r.name.includes('swap-a'))!.id;
    swapB = tmp.data!.find((r) => r.name.includes('swap-b'))!.id;
    const gym = (await admin.from('exercises').select('id, muscle_group').eq('equipment', 'gym').neq('muscle_group', 'testpattern')).data ?? [];
    for (const row of gym) seeded[row.muscle_group] = row.id;
    homeSquat = (await admin.from('exercises').select('id').eq('equipment', 'home').eq('muscle_group', 'squat').single()).data!.id;

    for (let i = 0; i < 3; i++) {
      const user = await createTestUser(admin, 'proposal');
      users.push(user);
      await completeProfile(user.id);
      const generated = await callFunction('generate-plan', user.jwt, { startDate: utcDate() });
      expect(generated.status).toBe(200);
      const planId = generated.json.planId as string;
      planIds.set(user.id, planId);
      await admin.from('plans').update({ start_date: utcDate(-2) }).eq('id', planId);

      // Day 5 uses the temporary exercise A in its first position, so a same-pattern swap can be proposed.
      const day5 = (await admin.from('plan_days').select('workout').eq('plan_id', planId).eq('day_number', 5).single()).data!.workout as Workout;
      if (day5.kind === 'workout') {
        day5.exercises[0] = { ...day5.exercises[0], exercise_id: swapA };
        await admin.from('plan_days').update({ workout: day5 }).eq('plan_id', planId).eq('day_number', 5);
      }
      const rows = (await admin.from('plan_days').select('day_number, workout, calorie_target, protein_target_g').eq('plan_id', planId)).data ?? [];
      original.set(user.id, new Map(rows.map((r) => [r.day_number, { workout: r.workout, calorie_target: r.calorie_target, protein_target_g: r.protein_target_g }])));
    }
  });

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
    await admin.from('exercises').delete().in('id', [swapA, swapB].filter(Boolean));
  });

  const [A, B, C] = [0, 1, 2].map((i) => () => users[i]);

  const baseDay = (user: TestUser, day: number) => original.get(user.id)!.get(day)!;
  const dayNow = async (user: TestUser, day: number): Promise<DayRow> =>
    (await admin.from('plan_days').select('workout, calorie_target, protein_target_g').eq('plan_id', planIds.get(user.id)!).eq('day_number', day).single()).data as DayRow;

  async function reset(user: TestUser) {
    await admin.from('coach_proposals').delete().eq('user_id', user.id);
    await admin.from('coach_messages').delete().eq('user_id', user.id);
    await admin.from('coach_requests').delete().eq('user_id', user.id);
    await admin.from('billing_state').delete().eq('user_id', user.id);
    await admin.from('entitlements').update({ tier: 'free', source: null }).eq('user_id', user.id);
    await completeProfile(user.id);
    await admin.from('plans').update({ start_date: utcDate(-2) }).eq('id', planIds.get(user.id)!);
    const rows = [...original.get(user.id)!.entries()]
      .filter(([day]) => day <= 24)
      .map(([day, v]) => ({ plan_id: planIds.get(user.id)!, user_id: user.id, day_number: day, workout: v.workout, calorie_target: v.calorie_target, protein_target_g: v.protein_target_g }));
    const restored = await admin.from('plan_days').upsert(rows, { onConflict: 'plan_id,day_number' });
    expect(restored.error).toBeNull();
  }
  beforeEach(async () => {
    for (const user of users) await reset(user);
  });

  const patchOf = (user: TestUser, day: number, next: CoachProposalPatch['next']) => ({
    dayNumber: day,
    next,
    expected: { workout: baseDay(user, day).workout, calorieTarget: baseDay(user, day).calorie_target, proteinTargetG: baseDay(user, day).protein_target_g },
  });
  const workoutOf = (user: TestUser, day: number, change: (e: { exercise_id: string; sets: number; reps: number }[]) => void): Workout => {
    const w = JSON.parse(JSON.stringify(baseDay(user, day).workout)) as Workout;
    if (w.kind === 'workout') change(w.exercises);
    return w;
  };

  // A stored, completed coach exchange with a proposal, written the way the ledger writes it.
  async function seedProposal(user: TestUser, patches: unknown[], status = 'pending', patch: unknown = { patches }) {
    const requestId = uuid();
    const base = { user_id: user.id, request_id: requestId };
    expect((await admin.from('coach_requests').insert({ ...base, quota_day: utcDate(), status: 'completed', lease_until: new Date().toISOString(), completed_at: new Date().toISOString() })).error).toBeNull();
    expect((await admin.from('coach_messages').insert({ ...base, message: 'a question', reply: 'a reply', language: 'en' })).error).toBeNull();
    const inserted = await admin.from('coach_proposals').insert({ ...base, patch, status }).select('id').single();
    expect(inserted.error).toBeNull();
    return inserted.data!.id as string;
  }
  const decide = async (user: TestUser, proposalId: string, decision: 'accept' | 'decline') => {
    const { data, error } = await admin.rpc('coach_decide_proposal', { p_user_id: user.id, p_proposal_id: proposalId, p_decision: decision });
    expect(error).toBeNull();
    return data as { status: string; reason?: string; changed_days?: number[]; current?: string };
  };
  const proposalRow = async (id: string) => (await admin.from('coach_proposals').select('status, decided_at, decision_reason, applied_days').eq('id', id).single()).data!;
  const makePremium = (user: TestUser) => admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id);
  const planUnchanged = async (user: TestUser, days: number[]) => {
    for (const d of days) expect(await dayNow(user, d)).toEqual(baseDay(user, d));
  };

  describe('accepting', () => {
    it('applies a valid proposal to every day it names, and to nothing else', async () => {
      const user = A();
      const w5 = workoutOf(user, 5, (e) => { e[1].sets += 1; e[2].reps += 2; });
      const id = await seedProposal(user, [
        patchOf(user, 5, { workout: w5, calorieTarget: 2750, proteinTargetG: 130 }),
        patchOf(user, 6, { calorieTarget: 2550 }),
      ]);

      const result = await decide(user, id, 'accept');

      expect(result).toMatchObject({ status: 'accepted', changed_days: [5, 6] });
      expect(await dayNow(user, 5)).toEqual({ workout: w5, calorie_target: 2750, protein_target_g: 130 });
      expect(await dayNow(user, 6)).toEqual({ ...baseDay(user, 6), calorie_target: 2550 });
      await planUnchanged(user, [4, 7, 8, 9, 10]);
      const row = await proposalRow(id);
      expect(row.status).toBe('accepted');
      expect(row.decided_at).not.toBeNull();
      expect(row.applied_days).toEqual([5, 6]);
    });

    it('accepts a swap to another exercise of the same pattern and equipment', async () => {
      const user = A();
      const w5 = workoutOf(user, 5, (e) => { e[0].exercise_id = swapB; });
      const id = await seedProposal(user, [patchOf(user, 5, { workout: w5 })]);

      expect((await decide(user, id, 'accept')).status).toBe('accepted');
      expect((await dayNow(user, 5)).workout).toEqual(w5);
    });

    it('lets a premium member change days past the free days', async () => {
      const user = C();
      await makePremium(user);
      const id = await seedProposal(user, [patchOf(user, 16, { calorieTarget: 2700 })]);

      expect((await decide(user, id, 'accept')).status).toBe('accepted');
      expect((await dayNow(user, 16)).calorie_target).toBe(2700);
    });
  });

  describe('declining', () => {
    it('changes no plan day and records the decision', async () => {
      const user = A();
      const id = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 }), patchOf(user, 6, { proteinTargetG: 130 })]);

      expect((await decide(user, id, 'decline')).status).toBe('declined');

      await planUnchanged(user, [5, 6, 7, 8]);
      const row = await proposalRow(id);
      expect(row.status).toBe('declined');
      expect(row.decided_at).not.toBeNull();
      expect(row.applied_days).toBeNull();
    });
  });

  describe('retries and conflicting decisions', () => {
    it('repeats an accept without applying it twice', async () => {
      const user = A();
      const id = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 })]);
      const first = await decide(user, id, 'accept');
      await admin.from('plan_days').update({ calorie_target: 2800 }).eq('plan_id', planIds.get(user.id)!).eq('day_number', 5); // a later change must survive

      const again = await decide(user, id, 'accept');

      expect(first).toMatchObject({ status: 'accepted', changed_days: [5] });
      expect(again).toMatchObject({ status: 'accepted', changed_days: [5] });
      expect((await dayNow(user, 5)).calorie_target).toBe(2800);
    });

    it('repeats a decline, and rejects the opposite decision either way round', async () => {
      const user = A();
      const declined = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 })]);
      expect((await decide(user, declined, 'decline')).status).toBe('declined');
      expect((await decide(user, declined, 'decline')).status).toBe('declined');
      expect(await decide(user, declined, 'accept')).toMatchObject({ status: 'conflict', current: 'declined' });
      await planUnchanged(user, [5]);

      const accepted = await seedProposal(user, [patchOf(user, 6, { calorieTarget: 2550 })]);
      expect((await decide(user, accepted, 'accept')).status).toBe('accepted');
      expect(await decide(user, accepted, 'decline')).toMatchObject({ status: 'conflict', current: 'accepted' });
      expect((await dayNow(user, 6)).calorie_target).toBe(2550);
    });

    it('applies once when the same accept arrives concurrently', async () => {
      const user = A();
      const id = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 }), patchOf(user, 8, { calorieTarget: 2700 })]);

      const results = await Promise.all(Array.from({ length: 6 }, () => decide(user, id, 'accept')));

      expect(results.every((r) => r.status === 'accepted' && r.changed_days?.join() === '5,8')).toBe(true);
      expect((await dayNow(user, 5)).calorie_target).toBe(2750);
      expect((await dayNow(user, 8)).calorie_target).toBe(2700);
    });

    it('lets exactly one of a concurrent accept and decline win', async () => {
      const user = A();
      const id = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 })]);

      const [accept, decline] = await Promise.all([decide(user, id, 'accept'), decide(user, id, 'decline')]);

      const row = await proposalRow(id);
      expect([accept.status, decline.status].sort()).toEqual(row.status === 'accepted' ? ['accepted', 'conflict'] : ['conflict', 'declined']);
      expect((await dayNow(user, 5)).calorie_target).toBe(row.status === 'accepted' ? 2750 : baseDay(user, 5).calorie_target);
    });

    it('declines a proposal that has gone stale, but never accepts it', async () => {
      const user = A();
      const id = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 })]);
      await admin.from('plan_days').update({ calorie_target: 2600 }).eq('plan_id', planIds.get(user.id)!).eq('day_number', 5);

      expect(await decide(user, id, 'accept')).toMatchObject({ status: 'stale', reason: 'stale_plan' });
      expect(await decide(user, id, 'accept')).toMatchObject({ status: 'stale', reason: 'stale_plan' });
      expect((await decide(user, id, 'decline')).status).toBe('declined');
    });
  });

  describe('accounts', () => {
    it('treats another account\'s proposal as not found for both decisions, changing nothing', async () => {
      const [a, b] = [A(), B()];
      const id = await seedProposal(a, [patchOf(a, 5, { calorieTarget: 2750 })]);

      expect((await decide(b, id, 'accept')).status).toBe('not_found');
      expect((await decide(b, id, 'decline')).status).toBe('not_found');

      await planUnchanged(a, [5]);
      await planUnchanged(b, [5]);
      expect((await proposalRow(id)).status).toBe('pending');
    });

    it('reports an unknown proposal as not found', async () => {
      expect((await decide(A(), uuid(), 'accept')).status).toBe('not_found');
    });

    it('applies a proposal only to the plan of the account that owns it', async () => {
      const [a, b] = [A(), B()];
      const id = await seedProposal(a, [patchOf(a, 5, { calorieTarget: 2750 })]);

      await decide(a, id, 'accept');

      expect((await dayNow(a, 5)).calorie_target).toBe(2750);
      expect(await dayNow(b, 5)).toEqual(baseDay(b, 5));
    });
  });

  describe('stale, locked and past days', () => {
    it.each([[1, 'a past day'], [2, 'a past day'], [3, 'today'], [4, 'tomorrow (could still be today in another time zone)']])(
      'refuses day %s (%s) and changes nothing',
      async (day) => {
        const user = A();
        const id = await seedProposal(user, [patchOf(user, day, { calorieTarget: baseDay(user, day).calorie_target! + 100 })]);

        expect(await decide(user, id, 'accept')).toMatchObject({ status: 'stale', reason: 'day_not_editable' });

        await planUnchanged(user, [day]);
        expect((await proposalRow(id)).status).toBe('stale');
      }
    );

    it('refuses a day a free member cannot open', async () => {
      const user = A();
      const id = await seedProposal(user, [patchOf(user, 15, { calorieTarget: 2700 })]);

      expect(await decide(user, id, 'accept')).toMatchObject({ status: 'stale', reason: 'day_not_editable' });
      await planUnchanged(user, [15]);
    });

    it('refuses a day beyond the horizon even for a premium member', async () => {
      const user = C();
      await makePremium(user);
      const id = await seedProposal(user, [patchOf(user, 20, { calorieTarget: 2700 })]);

      expect(await decide(user, id, 'accept')).toMatchObject({ status: 'stale', reason: 'day_not_editable' });
      await planUnchanged(user, [20]);
    });

    it('refuses once the member has lost the access that made the day editable', async () => {
      const user = C();
      await makePremium(user);
      const id = await seedProposal(user, [patchOf(user, 16, { calorieTarget: 2700 })]);
      await admin.from('entitlements').update({ tier: 'free' }).eq('user_id', user.id);

      expect(await decide(user, id, 'accept')).toMatchObject({ status: 'stale', reason: 'day_not_editable' });
      await planUnchanged(user, [16]);
    });

    it('refuses a lapsed subscription even while the tier column still says premium', async () => {
      const user = C();
      await makePremium(user);
      await admin.from('billing_state').upsert({ user_id: user.id, last_event_ms: 1, premium_active: true, premium_until_ms: Date.now() - 60000 });
      const id = await seedProposal(user, [patchOf(user, 16, { calorieTarget: 2700 })]);

      expect(await decide(user, id, 'accept')).toMatchObject({ status: 'stale', reason: 'day_not_editable' });
    });

    it('refuses when the day changed after the proposal was made, in any of its three fields', async () => {
      for (const change of [{ calorie_target: 2600 }, { protein_target_g: 126 }, { workout: { kind: 'rest' } }]) {
        const user = A();
        await reset(user);
        const id = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 })]);
        await admin.from('plan_days').update(change).eq('plan_id', planIds.get(user.id)!).eq('day_number', 5);
        const changed = await dayNow(user, 5);

        expect(await decide(user, id, 'accept')).toMatchObject({ status: 'stale', reason: 'stale_plan' });

        expect(await dayNow(user, 5)).toEqual(changed); // the newer value is never overwritten
      }
    });

    it('refuses when there is no plan or no usable profile any more', async () => {
      const user = A();
      const id = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 })]);
      await admin.from('profiles').update({ weight_kg: null }).eq('id', user.id);
      expect(await decide(user, id, 'accept')).toMatchObject({ status: 'stale', reason: 'no_profile' });

      await reset(user);
      const id2 = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 })]);
      await admin.from('plan_days').delete().eq('plan_id', planIds.get(user.id)!).eq('day_number', 5);
      expect((await decide(user, id2, 'accept')).status).toBe('stale');
    });
  });

  describe('all or nothing', () => {
    it('applies none of the days when one patch is invalid', async () => {
      const user = A();
      const id = await seedProposal(user, [
        patchOf(user, 5, { calorieTarget: 2750, proteinTargetG: 130 }), // valid
        patchOf(user, 8, { calorieTarget: 2701 }), // not on the plan rounding
        patchOf(user, 10, { calorieTarget: 2700 }), // valid
      ]);

      expect(await decide(user, id, 'accept')).toMatchObject({ status: 'stale', reason: 'calories_not_rounded' });

      await planUnchanged(user, [5, 8, 10]);
      const row = await proposalRow(id);
      expect(row.status).toBe('stale');
      expect(row.applied_days).toBeNull();
    });

    it('applies none of the days when one of them is stale', async () => {
      const user = A();
      const id = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 }), patchOf(user, 8, { calorieTarget: 2700 })]);
      await admin.from('plan_days').update({ protein_target_g: 99 }).eq('plan_id', planIds.get(user.id)!).eq('day_number', 8);

      expect((await decide(user, id, 'accept')).status).toBe('stale');

      expect((await dayNow(user, 5)).calorie_target).toBe(baseDay(user, 5).calorie_target);
    });
  });

  describe('stored patch integrity', () => {
    it.each([
      ['no patches', { patches: [] }],
      ['no expected values', { patches: [{ dayNumber: 5, next: { calorieTarget: 2750 } }] }],
      ['an unknown field', { patches: [{ dayNumber: 5, next: { calorieTarget: 2750, sql: 'x' }, expected: {} }] }],
      ['too many patches', { patches: Array.from({ length: 8 }, (_, i) => ({ dayNumber: 5 + i, next: { calorieTarget: 2750 }, expected: {} })) }],
    ])('refuses a stored patch with %s', async (_name, patch) => {
      const user = A();
      const id = await seedProposal(user, [], 'pending', patch);

      const result = await decide(user, id, 'accept').catch(() => ({ status: 'error' }));

      expect(['stale', 'error']).toContain(result.status);
      await planUnchanged(user, [5, 6, 8]);
    });

    it('cannot even store a patch that is not an object: the table refuses it', async () => {
      const requestId = uuid();
      const base = { user_id: A().id, request_id: requestId };
      await admin.from('coach_requests').insert({ ...base, quota_day: utcDate(), status: 'completed', lease_until: new Date().toISOString() });
      await admin.from('coach_messages').insert({ ...base, message: 'q', reply: 'r', language: 'en' });

      const { error } = await admin.from('coach_proposals').insert({ ...base, patch: [1, 2] });

      expect(error).not.toBeNull();
    });

    it('rejects an unknown decision', async () => {
      const user = A();
      const id = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 })]);

      const { error } = await admin.rpc('coach_decide_proposal', { p_user_id: user.id, p_proposal_id: id, p_decision: 'approve' });

      expect(error).not.toBeNull();
      expect((await proposalRow(id)).status).toBe('pending');
    });
  });

  // The database rules must agree with the TypeScript validator that checked the proposal when it was made.
  describe('agreement with the validator', () => {
    type Case = { name: string; patches: (user: TestUser) => unknown[]; setup?: (user: TestUser) => PromiseLike<unknown> };
    const nextCal = (user: TestUser, day: number, delta: number) => baseDay(user, day).calorie_target! + delta;
    const cases: Case[] = [
      // accepted
      { name: 'sets +1', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e[1].sets += 1; }) })] },
      { name: 'reps -2', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e[1].reps -= 2; }) })] },
      { name: 'swap within pattern', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e[0].exercise_id = swapB; }) })] },
      { name: 'calories +250', patches: (u) => [patchOf(u, 5, { calorieTarget: nextCal(u, 5, 250) })] },
      { name: 'calories -250', patches: (u) => [patchOf(u, 6, { calorieTarget: nextCal(u, 6, -250) })] },
      { name: 'protein at the low bound (112)', patches: (u) => [patchOf(u, 5, { proteinTargetG: 112 })] },
      { name: 'protein at the high bound (140)', patches: (u) => [patchOf(u, 5, { proteinTargetG: 140 })] },
      { name: 'seven days', patches: (u) => [5, 6, 7, 8, 9, 10, 11].map((d) => patchOf(u, d, { calorieTarget: nextCal(u, d, 50) })) },
      { name: 'last free day (14)', patches: (u) => [patchOf(u, 14, { calorieTarget: nextCal(u, 14, 50) })] },
      // rejected
      { name: 'protein 111', patches: (u) => [patchOf(u, 5, { proteinTargetG: 111 })] },
      { name: 'protein 141', patches: (u) => [patchOf(u, 5, { proteinTargetG: 141 })] },
      { name: 'protein not whole', patches: (u) => [patchOf(u, 5, { proteinTargetG: 120.5 })] },
      { name: 'calories not on the rounding', patches: (u) => [patchOf(u, 5, { calorieTarget: nextCal(u, 5, 25) })] },
      { name: 'calories +300', patches: (u) => [patchOf(u, 5, { calorieTarget: nextCal(u, 5, 300) })] },
      { name: 'calories -300', patches: (u) => [patchOf(u, 5, { calorieTarget: nextCal(u, 5, -300) })] },
      { name: 'calories not whole', patches: (u) => [patchOf(u, 5, { calorieTarget: nextCal(u, 5, 100) + 0.5 })] },
      {
        name: 'calories with no base target',
        setup: (u) => admin.from('plan_days').update({ calorie_target: null }).eq('plan_id', planIds.get(u.id)!).eq('day_number', 6),
        patches: (u) => [{ dayNumber: 6, next: { calorieTarget: 2700 }, expected: { workout: baseDay(u, 6).workout, calorieTarget: null, proteinTargetG: baseDay(u, 6).protein_target_g } }],
      },
      {
        name: 'calories when the raw estimate is below 1,500',
        setup: async (u) => {
          await admin.from('profiles').update({ weight_kg: 45, age: 60, energy_sex: 'female', activity_level: 'sedentary', goal: 'lose_fat' }).eq('id', u.id);
          return admin.from('plan_days').update({ calorie_target: 1550 }).eq('plan_id', planIds.get(u.id)!).eq('day_number', 6);
        },
        patches: (u) => [{ dayNumber: 6, next: { calorieTarget: 1500 }, expected: { workout: baseDay(u, 6).workout, calorieTarget: 1550, proteinTargetG: baseDay(u, 6).protein_target_g } }],
      },
      {
        name: 'calories when the energy inputs are missing',
        setup: (u) => admin.from('profiles').update({ energy_sex: 'undisclosed' }).eq('id', u.id),
        patches: (u) => [patchOf(u, 5, { calorieTarget: nextCal(u, 5, 100) })],
      },
      { name: 'unchanged calories', patches: (u) => [patchOf(u, 5, { calorieTarget: baseDay(u, 5).calorie_target! })] },
      { name: 'unchanged workout', patches: (u) => [patchOf(u, 5, { workout: baseDay(u, 5).workout })] },
      { name: 'an empty patch', patches: (u) => [patchOf(u, 5, {})] },
      { name: 'workout on a rest day', patches: (u) => [patchOf(u, 6, { workout: workoutOf(u, 5, () => undefined) })] },
      { name: 'rest on a workout day', patches: (u) => [patchOf(u, 5, { workout: { kind: 'rest' } })] },
      { name: 'unknown exercise', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e[0].exercise_id = uuid(); }) })] },
      { name: 'exercise id that is not an id', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e[0].exercise_id = "x'; drop table plan_days;--"; }) })] },
      { name: 'exercise of another equipment group', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e[0].exercise_id = homeSquat; }) })] },
      { name: 'exercise of another pattern', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e[1].exercise_id = seeded.push; }) })] },
      { name: 'repeated exercise', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e[1].exercise_id = e[0].exercise_id; }) })] },
      { name: 'one exercise fewer', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e.pop(); }) })] },
      { name: 'one exercise more', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e.push({ exercise_id: seeded.core, sets: 2, reps: 10 }); }) })] },
      { name: 'sets 0', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e[1].sets = 0; }) })] },
      { name: 'sets +2', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e[1].sets += 2; }) })] },
      { name: 'sets not whole', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e[1].sets = 2.5; }) })] },
      { name: 'reps +3', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e[1].reps += 3; }) })] },
      { name: 'reps 3', patches: (u) => [patchOf(u, 5, { workout: workoutOf(u, 5, (e) => { e[1].reps = 3; }) })] },
      { name: 'a past day', patches: (u) => [patchOf(u, 2, { calorieTarget: nextCal(u, 2, 50) })] },
      { name: 'tomorrow', patches: (u) => [patchOf(u, 4, { calorieTarget: nextCal(u, 4, 50) })] },
      { name: 'a free day past the free days', patches: (u) => [patchOf(u, 15, { calorieTarget: nextCal(u, 15, 50) })] },
      { name: 'the same day twice', patches: (u) => [patchOf(u, 5, { calorieTarget: nextCal(u, 5, 50) }), patchOf(u, 5, { calorieTarget: nextCal(u, 5, 100) })] },
      { name: 'eight days', patches: (u) => [5, 6, 7, 8, 9, 10, 11, 12].map((d) => patchOf(u, d, { calorieTarget: nextCal(u, d, 50) })) },
      { name: 'one bad day among good ones', patches: (u) => [patchOf(u, 5, { calorieTarget: nextCal(u, 5, 50) }), patchOf(u, 8, { proteinTargetG: 200 })] },
    ];

    // Which cases are meant to be valid. Agreement alone would also hold if both sides rejected everything.
    const VALID = new Set([
      'sets +1', 'reps -2', 'swap within pattern', 'calories +250', 'calories -250',
      'protein at the low bound (112)', 'protein at the high bound (140)', 'seven days', 'last free day (14)',
    ]);

    it('has both valid and invalid cases', () => {
      expect(cases.filter((c) => VALID.has(c.name))).toHaveLength(VALID.size);
      expect(cases.length - VALID.size).toBeGreaterThan(30);
    });

    it.each(cases.map((c) => [c.name, c] as const))('decides "%s" exactly as the validator does', async (_name, c) => {
      const user = A();
      if (c.setup) await c.setup(user);
      const patches = c.patches(user);
      const context = await loadCoachContext(admin, user.id);
      const plain = patches.map((p) => ({ dayNumber: (p as CoachProposalPatch).dayNumber, next: (p as CoachProposalPatch).next }));
      let allowed = false;
      try {
        allowed = validateCoachReply({ text: 'x', proposal: { patches: plain as CoachProposalPatch[] } }, context).proposal !== null;
      } catch {
        allowed = false;
      }
      expect(allowed).toBe(VALID.has(c.name)); // the validator itself must give the intended answer
      const before = await Promise.all([5, 6, 7, 8, 9, 10, 11, 12, 14, 15].map((d) => dayNow(user, d)));
      const id = await seedProposal(user, patches);

      const result = await decide(user, id, 'accept');

      expect(result.status).toBe(allowed ? 'accepted' : 'stale');
      if (!allowed) {
        const after = await Promise.all([5, 6, 7, 8, 9, 10, 11, 12, 14, 15].map((d) => dayNow(user, d)));
        expect(after).toEqual(before); // refused means no day moved
      }
    });

    it('agrees for a premium member about days past the free days and the horizon', async () => {
      const user = C();
      await makePremium(user);
      for (const [day, delta] of [[15, 50], [17, 50], [18, 50], [20, 50]] as const) {
        await reset(user);
        await makePremium(user);
        const patches = [patchOf(user, day, { calorieTarget: nextCal(user, day, delta) })];
        const context = await loadCoachContext(admin, user.id);
        const allowed = validateCoachReply({ text: 'x', proposal: { patches: patches.map((p) => ({ dayNumber: p.dayNumber, next: p.next })) } }, context).proposal !== null;
        const id = await seedProposal(user, patches);

        expect((await decide(user, id, 'accept')).status).toBe(allowed ? 'accepted' : 'stale');
      }
    });
  });

  describe('server-only writes', () => {
    it('stops a client changing plan days, proposals or the decision function', async () => {
      const [a, b] = [A(), B()];
      const id = await seedProposal(a, [patchOf(a, 5, { calorieTarget: 2750 })]);

      const direct = await a.client.from('plan_days').update({ calorie_target: 9999 }).eq('plan_id', planIds.get(a.id)!).eq('day_number', 5).select();
      const status = await a.client.from('coach_proposals').update({ status: 'accepted' }).eq('id', id).select();
      const patch = await a.client.from('coach_proposals').update({ patch: { patches: [] } }).eq('id', id).select();
      const del = await a.client.from('coach_proposals').delete().eq('id', id).select();
      const insert = await a.client.from('coach_proposals').insert({ user_id: a.id, request_id: uuid(), patch: { patches: [] } });
      const rpc = await a.client.rpc('coach_decide_proposal', { p_user_id: a.id, p_proposal_id: id, p_decision: 'accept' });
      const anon = await createTestClient(publishableKey).rpc('coach_decide_proposal', { p_user_id: a.id, p_proposal_id: id, p_decision: 'accept' });
      const foreign = await b.client.from('coach_proposals').update({ status: 'declined' }).eq('id', id).select();

      expect(direct.data ?? []).toEqual([]);
      for (const attempt of [status, patch, del, insert, rpc, anon, foreign]) expect(attempt.error).not.toBeNull();
      expect((await proposalRow(id)).status).toBe('pending');
      await planUnchanged(a, [5]);
    });

    it('lets a member read their own proposal, and not another member\'s', async () => {
      const [a, b] = [A(), B()];
      const id = await seedProposal(a, [patchOf(a, 5, { calorieTarget: 2750 })]);

      expect((await a.client.from('coach_proposals').select('id, status').eq('id', id)).data).toEqual([{ id, status: 'pending' }]);
      expect((await b.client.from('coach_proposals').select('id').eq('id', id)).data).toEqual([]);
    });
  });

  describe('decide-coach-proposal function', () => {
    const call = (user: TestUser | null, body: unknown) => callFunction('decide-coach-proposal', user?.jwt, body as object);

    it('answers 401 without a JWT and with a bad one', async () => {
      const id = await seedProposal(A(), [patchOf(A(), 5, { calorieTarget: 2750 })]);

      expect((await call(null, { proposalId: id, decision: 'accept' })).status).toBe(401);
      expect((await callFunction('decide-coach-proposal', 'nope', { proposalId: id, decision: 'accept' })).status).toBe(401);
      await planUnchanged(A(), [5]);
    });

    it('answers 405 to a GET', async () => {
      const res = await nodeFetch(`${supabaseUrl}/functions/v1/decide-coach-proposal`, { method: 'GET', headers: { apikey: publishableKey } });

      expect(res.status).toBe(405);
    });

    it.each([
      ['no proposal id', { decision: 'accept' }],
      ['a bad decision', { proposalId: uuid(), decision: 'maybe' }],
      ['a patch from the client', { proposalId: uuid(), decision: 'accept', patch: { patches: [] } }],
      ['a user id from the client', { proposalId: uuid(), decision: 'accept', userId: uuid() }],
    ])('answers 400 for %s', async (_name, body) => {
      const res = await call(A(), body);

      expect(res).toMatchObject({ status: 400, json: { error: 'INVALID_REQUEST' } });
    });

    it('never applies content from the request: the stored patch is what changes', async () => {
      const user = A();
      const id = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 })]);
      const forged = { proposalId: id, decision: 'accept', patch: { patches: [patchOf(user, 5, { calorieTarget: 2900 })] }, calorieTarget: 2900 };

      expect((await call(user, forged)).status).toBe(400);
      await planUnchanged(user, [5]);

      expect((await call(user, { proposalId: id, decision: 'accept' })).status).toBe(200);
      expect((await dayNow(user, 5)).calorie_target).toBe(2750);
    });

    it('accepts, repeats the accept, and refuses the opposite decision', async () => {
      const user = A();
      const id = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 }), patchOf(user, 8, { calorieTarget: 2700 })]);

      const first = await call(user, { proposalId: id, decision: 'accept' });
      const again = await call(user, { proposalId: id, decision: 'accept' });
      const opposite = await call(user, { proposalId: id, decision: 'decline' });

      expect(first).toMatchObject({ status: 200, json: { status: 'accepted', proposalId: id, changedDays: [5, 8] } });
      expect(again).toMatchObject({ status: 200, json: { status: 'accepted', changedDays: [5, 8] } });
      expect(opposite).toMatchObject({ status: 409, json: { error: 'DECISION_CONFLICT', current: 'accepted' } });
      expect((await dayNow(user, 8)).calorie_target).toBe(2700);
    });

    it('declines without changing the plan', async () => {
      const user = A();
      const id = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 })]);

      expect(await call(user, { proposalId: id, decision: 'decline' })).toMatchObject({ status: 200, json: { status: 'declined' } });
      await planUnchanged(user, [5]);
    });

    it('answers 409 PROPOSAL_STALE for a stale proposal and changes nothing', async () => {
      const user = A();
      const id = await seedProposal(user, [patchOf(user, 3, { calorieTarget: 2750 })]);

      expect(await call(user, { proposalId: id, decision: 'accept' })).toMatchObject({ status: 409, json: { error: 'PROPOSAL_STALE', reason: 'day_not_editable' } });
      await planUnchanged(user, [3]);
    });

    it('answers 404 for another account\'s proposal, exactly as for one that does not exist', async () => {
      const [a, b] = [A(), B()];
      const id = await seedProposal(a, [patchOf(a, 5, { calorieTarget: 2750 })]);

      const foreign = await call(b, { proposalId: id, decision: 'accept' });
      const missing = await call(b, { proposalId: uuid(), decision: 'accept' });

      expect(foreign).toMatchObject({ status: 404, json: { error: 'PROPOSAL_NOT_FOUND' } });
      expect(missing).toMatchObject({ status: 404, json: { error: 'PROPOSAL_NOT_FOUND' } });
      await planUnchanged(a, [5]);
    });

    it('applies once when many identical accepts arrive at the same time', async () => {
      const user = A();
      const id = await seedProposal(user, [patchOf(user, 5, { calorieTarget: 2750 })]);

      const results = await Promise.all(Array.from({ length: 5 }, () => call(user, { proposalId: id, decision: 'accept' })));

      expect(results.every((r) => r.status === 200 && r.json.status === 'accepted')).toBe(true);
      expect((await dayNow(user, 5)).calorie_target).toBe(2750);
    });
  });

  describe('account deletion', () => {
    it('removes proposals, exchanges and the plan with the account', async () => {
      const doomed = await createTestUser(admin, 'proposal-del');
      try {
        await completeProfile(doomed.id);
        const generated = await callFunction('generate-plan', doomed.jwt, { startDate: utcDate() });
        const planId = generated.json.planId as string;
        await admin.from('plans').update({ start_date: utcDate(-2) }).eq('id', planId);
        const day = (await admin.from('plan_days').select('workout, calorie_target, protein_target_g').eq('plan_id', planId).eq('day_number', 5).single()).data!;
        const id = await seedProposal(doomed, [
          { dayNumber: 5, next: { calorieTarget: 2750 }, expected: { workout: day.workout, calorieTarget: day.calorie_target, proteinTargetG: day.protein_target_g } },
        ]);
        expect((await decide(doomed, id, 'accept')).status).toBe('accepted');

        const { status } = await callFunction('delete-account', doomed.jwt, {});

        expect(status).toBe(200);
        for (const table of ['coach_proposals', 'coach_messages', 'coach_requests']) {
          expect((await admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', doomed.id)).count).toBe(0);
        }
        expect((await admin.from('plan_days').select('*', { count: 'exact', head: true }).eq('plan_id', planId)).count).toBe(0);
      } finally {
        await admin.auth.admin.deleteUser(doomed.id); // a no-op when the test already deleted the account
      }
    });
  });
});
