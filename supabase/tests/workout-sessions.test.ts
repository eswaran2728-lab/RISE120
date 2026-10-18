import { callFunction, createAdmin, createTestUser, TestUser } from './helpers';
import { buildPlanDays, NUTRITION_RULES } from '../functions/_shared/plan/generate';

jest.setTimeout(300000);

const utcDate = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const REQUEST = () => crypto.randomUUID();
const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'A. Coach', role: 'Certified strength coach', reviewedOn: '2026-10-10' };
const media = { kind: 'video', source: 'Rise120 Studio', licence: 'Owned by Rise120' };

// Roadmap C2: starting a session stores an owned, immutable snapshot of a published template. Starting is
// idempotent, resumes the day's active session instead of making a second one, and only reviewed templates can
// be started.
describe('workout sessions (live)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  const users: TestUser[] = [];
  const ids = { a: `ws-a-${suffix}`, b: `ws-b-${suffix}`, template: `ws-t-${suffix}`, draft: `ws-d-${suffix}` };
  let seedExercises: { id: string; name: string; muscle_group: string; equipment: string; instructions: string }[] = [];

  beforeAll(async () => {
    seedExercises = (await admin.from('exercises').select('id, name, muscle_group, equipment, instructions')).data ?? [];
    const exercise = (id: string, alt: string) => ({ id, version: 1, pattern: 'squat', equipment: 'none', name: L(id), cues: [L('one'), L('two')], regressions: [], alternatives: [alt], media, reviewer, status: 'published' });
    expect((await admin.from('exercise_versions').insert([exercise(ids.a, ids.b), exercise(ids.b, ids.a)])).error).toBeNull();
    const template = (id: string, over: Record<string, unknown> = {}) => ({
      id, version: 1, goal: 'recomp', level: 'beginner', minutes: 10, location: 'home', day_type: 'training',
      exercises: [{ exerciseId: ids.a, sets: 3, reps: 10 }, { exerciseId: ids.b, sets: 2, reps: 12 }], reviewer, status: 'published', ...over,
    });
    expect((await admin.from('session_templates').insert([template(ids.template), template(ids.draft, { status: 'draft', reviewer: null })])).error).toBeNull();
  });
  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
    await admin.from('session_templates').delete().in('id', [ids.template, ids.draft]);
    await admin.from('exercise_versions').delete().in('id', [ids.a, ids.b]);
  });

  const freshUser = async (label = 'session') => {
    const user = await createTestUser(admin, label);
    users.push(user);
    await admin
      .from('profiles')
      .update({ age: 30, height_cm: 175, weight_kg: 70, goal: 'recomp', training_level: 'beginner', equipment: 'gym', energy_sex: 'male', activity_level: 'light', onboarded_at: new Date().toISOString() })
      .eq('id', user.id);
    return user;
  };
  // A plan that began `daysAgo` days ago, so today is day daysAgo + 1.
  const planStartedAgo = async (user: TestUser, daysAgo: number) => {
    const start = utcDate(-daysAgo);
    const days = buildPlanDays({ age: 30, heightCm: 175, weightKg: 70, goal: 'recomp', trainingLevel: 'beginner', equipment: 'gym', energySex: 'male', activityLevel: 'light' }, start, seedExercises, NUTRITION_RULES).map(({ date: _d, ...day }) => day);
    const { data, error } = await admin.rpc('create_plan_with_days', { p_user_id: user.id, p_start_date: start, p_days: days });
    expect(error).toBeNull();
    return data[0].result_plan_id as string;
  };
  const start = (user: TestUser, planId: string, dayNumber: number, over: Record<string, unknown> = {}) =>
    callFunction('start-session', user.jwt, { requestId: REQUEST(), planId, dayNumber, templateId: ids.template, templateVersion: 1, ...over });
  const sessionsOf = async (user: TestUser) => (await admin.from('workout_sessions').select('id, status, day_number, template_id').eq('user_id', user.id)).data ?? [];

  it('answers 401 without a JWT and 400 for a bad body', async () => {
    const user = await freshUser();
    const plan = await planStartedAgo(user, 4);

    expect((await callFunction('start-session', undefined, {})).status).toBe(401);
    expect((await start(user, plan, 5, { templateId: 'Bad Id' })).status).toBe(400);
    expect((await start(user, plan, 0)).status).toBe(400);
    expect(await sessionsOf(user)).toHaveLength(0);
  });

  it('stores an immutable snapshot of the published template with the exercise names', async () => {
    const user = await freshUser();
    const plan = await planStartedAgo(user, 4); // today is day 5

    const result = await start(user, plan, 5);

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ status: 'created', snapshot: { templateId: ids.template, version: 1, minutes: 10 } });
    expect(result.json.snapshot.exercises).toEqual([
      expect.objectContaining({ exerciseId: ids.a, sets: 3, reps: 10, name: L(ids.a), pattern: 'squat', equipment: 'none' }),
      expect.objectContaining({ exerciseId: ids.b, sets: 2, reps: 12, name: L(ids.b) }),
    ]);
    const stored = (await user.client.from('workout_sessions').select('id, status, snapshot, day_number').eq('id', result.json.sessionId).single()).data;
    expect(stored).toMatchObject({ status: 'active', day_number: 5 });
  });

  it('keeps the snapshot when the template is later withdrawn or changed', async () => {
    const user = await freshUser();
    const plan = await planStartedAgo(user, 4);
    const result = await start(user, plan, 5);
    const before = (await admin.from('workout_sessions').select('snapshot').eq('id', result.json.sessionId).single()).data?.snapshot;

    await admin.from('session_templates').update({ status: 'draft', reviewer: null }).eq('id', ids.template);
    await admin.from('session_templates').update({ status: 'published', reviewer, minutes: 10 }).eq('id', ids.template);

    expect((await admin.from('workout_sessions').select('snapshot').eq('id', result.json.sessionId).single()).data?.snapshot).toEqual(before);
  });

  it('cannot have its snapshot, plan, day or template edited, even by the service role', async () => {
    const user = await freshUser();
    const plan = await planStartedAgo(user, 4);
    const sessionId = (await start(user, plan, 5)).json.sessionId as string;

    for (const change of [{ snapshot: { hacked: true } }, { day_number: 6 }, { template_id: 'other' }, { plan_id: crypto.randomUUID() }]) {
      expect((await admin.from('workout_sessions').update(change).eq('id', sessionId)).error).not.toBeNull();
    }
    expect((await admin.from('workout_sessions').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', sessionId)).error).toBeNull();
  });

  it('answers a repeat of the same request with the same session and creates no second row', async () => {
    const user = await freshUser();
    const plan = await planStartedAgo(user, 4);
    const requestId = REQUEST();

    const first = await start(user, plan, 5, { requestId });
    const again = await start(user, plan, 5, { requestId });

    expect(first.json.status).toBe('created');
    expect(again.json).toMatchObject({ status: 'existing', sessionId: first.json.sessionId });
    expect(await sessionsOf(user)).toHaveLength(1);
  });

  it('creates exactly one session when the same request arrives many times at once', async () => {
    const user = await freshUser();
    const plan = await planStartedAgo(user, 4);
    const requestId = REQUEST();

    const results = await Promise.all(Array.from({ length: 5 }, () => start(user, plan, 5, { requestId })));

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.json.sessionId)).size).toBe(1);
    expect(await sessionsOf(user)).toHaveLength(1);
  });

  it('resumes the day\'s active session when a different request comes in, instead of starting a second', async () => {
    const user = await freshUser();
    const plan = await planStartedAgo(user, 4);
    const first = await start(user, plan, 5);

    const second = await start(user, plan, 5);

    expect(second.json).toMatchObject({ status: 'resumed', sessionId: first.json.sessionId });
    expect(await sessionsOf(user)).toHaveLength(1);
  });

  it('lets a new session start once the earlier one is completed', async () => {
    const user = await freshUser();
    const plan = await planStartedAgo(user, 4);
    const first = await start(user, plan, 5);
    await admin.from('workout_sessions').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', first.json.sessionId);

    const next = await start(user, plan, 5);

    expect(next.json).toMatchObject({ status: 'created' });
    expect(next.json.sessionId).not.toBe(first.json.sessionId);
  });

  it('refuses a draft, withdrawn or unknown template, and creates nothing', async () => {
    const user = await freshUser();
    const plan = await planStartedAgo(user, 4);

    const draft = await start(user, plan, 5, { templateId: ids.draft });
    const unknown = await start(user, plan, 5, { templateId: 'no-such-template' });
    const wrongVersion = await start(user, plan, 5, { templateVersion: 7 });

    for (const result of [draft, unknown, wrongVersion]) {
      expect(result.status).toBe(404);
      expect(result.json).toMatchObject({ error: 'TEMPLATE_UNAVAILABLE' });
    }
    expect(await sessionsOf(user)).toHaveLength(0);
  });

  it('refuses a plan that belongs to someone else, as if it did not exist', async () => {
    const a = await freshUser('session-a');
    const b = await freshUser('session-b');
    const planOfA = await planStartedAgo(a, 4);

    const result = await start(b, planOfA, 5);

    expect(result.status).toBe(404);
    expect(result.json).toMatchObject({ error: 'PLAN_NOT_FOUND' });
    expect(await sessionsOf(a)).toHaveLength(0);
    expect(await sessionsOf(b)).toHaveLength(0);
  });

  it('refuses a day in the future and a day a free member cannot open', async () => {
    const user = await freshUser();
    const plan = await planStartedAgo(user, 29); // today is day 30; a free member can open days 1 to 14

    expect((await start(user, plan, 40)).status).toBe(409);
    const locked = await start(user, plan, 20);
    expect(locked.status).toBe(409);
    expect(locked.json).toMatchObject({ error: 'DAY_NOT_AVAILABLE' });
    await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id);
    expect((await start(user, plan, 20)).status).toBe(200);
  });

  it('only the owner can read a session, and nobody can write one through the Data API', async () => {
    const a = await freshUser('session-a');
    const b = await freshUser('session-b');
    const plan = await planStartedAgo(a, 4);
    const sessionId = (await start(a, plan, 5)).json.sessionId as string;

    expect((await b.client.from('workout_sessions').select('id').eq('id', sessionId)).data ?? []).toEqual([]);
    expect((await a.client.from('workout_sessions').select('id').eq('id', sessionId)).data).toHaveLength(1);
    const insert = await a.client.from('workout_sessions').insert({ user_id: a.id, plan_id: plan, day_number: 5, request_id: REQUEST(), template_id: ids.template, template_version: 1, snapshot: {} });
    const update = await a.client.from('workout_sessions').update({ status: 'completed' }).eq('id', sessionId).select('id');
    expect(insert.error).not.toBeNull();
    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);
    expect((await admin.from('workout_sessions').select('status').eq('id', sessionId).single()).data?.status).toBe('active');
  });

  it('cannot be started through the database function by a signed-in member directly', async () => {
    const user = await freshUser();
    const plan = await planStartedAgo(user, 4);

    const attempt = await user.client.rpc('start_workout_session', { p_user_id: user.id, p_request_id: REQUEST(), p_plan_id: plan, p_day_number: 5, p_template_id: ids.template, p_template_version: 1 });

    expect(attempt.error).not.toBeNull();
    expect(await sessionsOf(user)).toHaveLength(0);
  });

  it('is removed with the account', async () => {
    const user = await freshUser();
    const plan = await planStartedAgo(user, 4);
    await start(user, plan, 5);
    expect(await sessionsOf(user)).toHaveLength(1);

    await admin.auth.admin.deleteUser(user.id);

    expect(await sessionsOf(user)).toHaveLength(0);
    users.splice(users.indexOf(user), 1);
  });
});
