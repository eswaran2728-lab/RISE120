import { callFunction, createAdmin, createTestUser, TestUser } from './helpers';
import { buildPlanDays, NUTRITION_RULES } from '../functions/_shared/plan/generate';

jest.setTimeout(300000);

const utcDate = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const REQUEST = () => crypto.randomUUID();
const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'A. Coach', role: 'Certified strength coach', reviewedOn: '2026-10-10' };
const media = { kind: 'video', source: 'Rise120 Studio', licence: 'Owned by Rise120' };

// Roadmap C3: swapping the remaining sets of an exercise and finishing a session. A swap never changes a set that
// was already logged, is refused for unsuitable equipment or a stale revision, and a session completes once.
describe('session swaps and completion (live)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  const users: TestUser[] = [];
  const ids = {
    a: `sa-a-${suffix}`, // squat, in the template, alternatives: ok, gym, b, draft
    b: `sa-b-${suffix}`, // second exercise in the template
    ok: `sa-ok-${suffix}`, // suitable alternative (bodyweight)
    gym: `sa-gym-${suffix}`, // alternative that needs a gym
    unlisted: `sa-un-${suffix}`, // suitable but not a reviewed alternative of a
    draft: `sa-dr-${suffix}`, // listed but never published
    template: `sa-t-${suffix}`,
  };
  let seed: { id: string; name: string; muscle_group: string; equipment: string; instructions: string }[] = [];

  beforeAll(async () => {
    seed = (await admin.from('exercises').select('id, name, muscle_group, equipment, instructions')).data ?? [];
    expect(seed.length).toBeGreaterThanOrEqual(5);
    const exercise = (id: string, over: Record<string, unknown> = {}) => ({ id, version: 1, pattern: 'squat', equipment: 'none', name: L(id), cues: [L('one'), L('two')], regressions: [], alternatives: [], media, reviewer, status: 'published', ...over });
    const rows = [
      exercise(ids.a, { equipment: 'home', alternatives: [ids.ok, ids.gym, ids.b, ids.draft] }),
      exercise(ids.b, { pattern: 'push' }),
      exercise(ids.ok),
      exercise(ids.gym, { equipment: 'gym' }),
      exercise(ids.unlisted),
      exercise(ids.draft, { status: 'draft', reviewer: null, media: null, cues: [] }),
    ];
    expect((await admin.from('exercise_versions').insert(rows)).error).toBeNull();
    const template = { id: ids.template, version: 1, goal: 'recomp', level: 'beginner', minutes: 10, location: 'home', day_type: 'training', exercises: [{ exerciseId: ids.a, sets: 3, reps: 10 }, { exerciseId: ids.b, sets: 2, reps: 12 }], reviewer, status: 'published' };
    expect((await admin.from('session_templates').insert(template)).error).toBeNull();
    const links = [ids.a, ids.b, ids.ok, ids.gym, ids.unlisted].map((catalogue_id, i) => ({ catalogue_id, exercise_id: seed[i].id }));
    expect((await admin.from('exercise_links').insert(links)).error).toBeNull();
  });
  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
    await admin.from('exercise_links').delete().in('catalogue_id', [ids.a, ids.b, ids.ok, ids.gym, ids.unlisted]);
    await admin.from('session_templates').delete().eq('id', ids.template);
    await admin.from('exercise_versions').delete().in('id', [ids.a, ids.b, ids.ok, ids.gym, ids.unlisted, ids.draft]);
  });

  const exUuid = (catalogueId: string) => seed[[ids.a, ids.b, ids.ok, ids.gym, ids.unlisted].indexOf(catalogueId)].id;

  const startedSession = async (equipment = 'home') => {
    const user = await createTestUser(admin, 'actions');
    users.push(user);
    await admin.from('profiles').update({ age: 30, height_cm: 175, weight_kg: 70, goal: 'recomp', training_level: 'beginner', equipment, energy_sex: 'male', activity_level: 'light', onboarded_at: new Date().toISOString() }).eq('id', user.id);
    const start = utcDate(-4);
    const days = buildPlanDays({ age: 30, heightCm: 175, weightKg: 70, goal: 'recomp', trainingLevel: 'beginner', equipment: 'gym', energySex: 'male', activityLevel: 'light' }, start, seed, NUTRITION_RULES).map(({ date: _d, ...day }) => day);
    const plan = await admin.rpc('create_plan_with_days', { p_user_id: user.id, p_start_date: start, p_days: days });
    const result = await callFunction('start-session', user.jwt, { requestId: REQUEST(), planId: plan.data[0].result_plan_id, dayNumber: 5, templateId: ids.template, templateVersion: 1 });
    expect(result.status).toBe(200);
    return { user, sessionId: result.json.sessionId as string };
  };
  const logSets = async (user: TestUser, sessionId: string, catalogueId: string, count: number, reps = 10, weightKg = 20) => {
    const rows = Array.from({ length: count }, (_, i) => ({ user_id: user.id, log_date: utcDate(0), exercise_id: exUuid(catalogueId), set_number: i + 1, reps, weight_kg: weightKg, session_id: sessionId }));
    expect((await admin.from('workout_logs').insert(rows)).error).toBeNull();
  };
  const swap = (user: TestUser, sessionId: string, over: Record<string, unknown> = {}) =>
    callFunction('session-actions', user.jwt, { action: 'swap', requestId: REQUEST(), sessionId, expectedRevision: 0, fromExerciseId: ids.a, replacementId: ids.ok, ...over });
  const complete = (user: TestUser, sessionId: string) => callFunction('session-actions', user.jwt, { action: 'complete', sessionId });
  const logsOf = async (user: TestUser) => (await admin.from('workout_logs').select('id, exercise_id, set_number, reps, weight_kg, session_id').eq('user_id', user.id).order('set_number')).data ?? [];

  it('answers 401 without a JWT and 400 for a malformed body', async () => {
    const { user, sessionId } = await startedSession();

    expect((await callFunction('session-actions', undefined, {})).status).toBe(401);
    expect((await callFunction('session-actions', user.jwt, { action: 'dance' })).status).toBe(400);
    expect((await swap(user, sessionId, { sessionId: 'nope' })).status).toBe(400);
    expect((await swap(user, sessionId, { expectedRevision: -1 })).status).toBe(400);
  });

  it('swaps only the remaining sets, leaves every logged set exactly as it was, and bumps the revision', async () => {
    const { user, sessionId } = await startedSession();
    await logSets(user, sessionId, ids.a, 2);
    const before = await logsOf(user);

    const result = await swap(user, sessionId);

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ status: 'swapped', revision: 1 });
    expect(result.json.exercises).toEqual([
      expect.objectContaining({ exerciseId: ids.a, sets: 2, kept: true }), // what was done stays under the original
      expect.objectContaining({ exerciseId: ids.ok, sets: 1, reps: 10, name: L(ids.ok) }),
      expect.objectContaining({ exerciseId: ids.b, sets: 2 }),
    ]);
    expect(await logsOf(user)).toEqual(before);
  });

  it('swaps a whole exercise when nothing has been done yet', async () => {
    const { user, sessionId } = await startedSession();

    const result = await swap(user, sessionId);

    expect(result.json.exercises.map((e: { exerciseId: string; sets: number }) => [e.exerciseId, e.sets])).toEqual([[ids.ok, 3], [ids.b, 2]]);
  });

  it('refuses a stale revision and changes nothing', async () => {
    const { user, sessionId } = await startedSession();
    expect((await swap(user, sessionId)).status).toBe(200); // revision is now 1

    const stale = await swap(user, sessionId, { fromExerciseId: ids.b, replacementId: ids.unlisted, expectedRevision: 0 });

    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ error: 'REVISION_CONFLICT', revision: 1 });
    expect((await admin.from('workout_session_swaps').select('id').eq('session_id', sessionId)).data).toHaveLength(1);
  });

  it('answers a repeat of the same request with the same result and makes no second swap', async () => {
    const { user, sessionId } = await startedSession();
    const requestId = REQUEST();

    const first = await swap(user, sessionId, { requestId });
    const again = await swap(user, sessionId, { requestId }); // the first answer was lost

    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ status: 'existing', revision: 1, exercises: first.json.exercises });
    expect((await admin.from('workout_session_swaps').select('id').eq('session_id', sessionId)).data).toHaveLength(1);
  });

  it('refuses equipment the member cannot use, replacements that are not reviewed alternatives, drafts and duplicates', async () => {
    const { user, sessionId } = await startedSession('home');

    expect((await swap(user, sessionId, { replacementId: ids.gym })).json.error).toBe('EQUIPMENT_UNSUITABLE'); // at home, no gym equipment
    expect((await swap(user, sessionId, { replacementId: ids.unlisted })).json.error).toBe('NOT_AN_ALTERNATIVE');
    expect((await swap(user, sessionId, { replacementId: ids.draft })).json.error).toBe('REPLACEMENT_UNAVAILABLE');
    expect((await swap(user, sessionId, { replacementId: ids.b })).json.error).toBe('ALREADY_IN_SESSION');
    expect((await swap(user, sessionId, { fromExerciseId: ids.unlisted })).json.error).toBe('EXERCISE_NOT_IN_SESSION');
    expect((await admin.from('workout_session_swaps').select('id').eq('session_id', sessionId)).data).toEqual([]);
  });

  it('refuses a swap when no sets of that exercise remain', async () => {
    const { user, sessionId } = await startedSession();
    await logSets(user, sessionId, ids.a, 3);

    const result = await swap(user, sessionId);

    expect(result.status).toBe(422);
    expect(result.json.error).toBe('NOTHING_TO_SWAP');
  });

  it('never lets one account swap or finish another accounts session', async () => {
    const owner = await startedSession();
    const other = await createTestUser(admin, 'intruder');
    users.push(other);

    expect((await swap(other, owner.sessionId)).status).toBe(404);
    expect((await complete(other, owner.sessionId)).status).toBe(404);
    expect((await admin.from('workout_session_swaps').select('id').eq('session_id', owner.sessionId)).data).toEqual([]);
  });

  it('completes from the sets actually logged, not the planned volume', async () => {
    const { user, sessionId } = await startedSession();
    await logSets(user, sessionId, ids.a, 2, 10, 20); // planned: 5 sets; done: 2

    const result = await complete(user, sessionId);

    expect(result.status).toBe(200);
    expect(result.json.status).toBe('completed');
    expect(result.json.summary).toMatchObject({ setsCompleted: 2, totalReps: 20, volumeKg: 400 });
    expect(result.json.summary.byExercise).toEqual([expect.objectContaining({ sets: 2, reps: 20, volumeKg: 400 })]);
    expect((await admin.from('workout_sessions').select('status, completed_at').eq('id', sessionId).single()).data?.status).toBe('completed');
  });

  it('completes once: a repeat returns the same summary and time, and concurrent taps make one completion', async () => {
    const { user, sessionId } = await startedSession();
    await logSets(user, sessionId, ids.a, 1);

    const [x, y] = await Promise.all([complete(user, sessionId), complete(user, sessionId)]);
    const statuses = [x.json.status, y.json.status].sort();
    const again = await complete(user, sessionId);

    expect(statuses).toEqual(['completed', 'existing']);
    expect(x.json.summary).toEqual(y.json.summary);
    expect(again.json).toMatchObject({ status: 'existing', summary: x.json.summary });
    const row = (await admin.from('workout_sessions').select('completed_at, summary').eq('id', sessionId).single()).data;
    expect(row?.summary).toEqual(x.json.summary);
    expect(new Date(row!.completed_at).toISOString()).toBe(new Date(again.json.completedAt).toISOString());
  });

  it('refuses to complete a session with nothing logged and leaves it active', async () => {
    const { user, sessionId } = await startedSession();

    const result = await complete(user, sessionId);

    expect(result.status).toBe(409);
    expect(result.json.error).toBe('NOTHING_LOGGED');
    expect((await admin.from('workout_sessions').select('status').eq('id', sessionId).single()).data?.status).toBe('active');
  });

  it('refuses a swap after the session is completed, and a completed summary cannot be edited', async () => {
    const { user, sessionId } = await startedSession();
    await logSets(user, sessionId, ids.a, 1);
    await complete(user, sessionId);

    const late = await swap(user, sessionId);

    expect(late.status).toBe(409);
    expect(late.json.error).toBe('SESSION_COMPLETED');
    expect((await admin.from('workout_sessions').update({ summary: { setsCompleted: 99 } }).eq('id', sessionId)).error).not.toBeNull();
    expect((await admin.from('workout_sessions').update({ revision: 5 }).eq('id', sessionId)).error).not.toBeNull();
  });

  it('lets the owner read the current exercises and revision, and nobody else', async () => {
    const { user, sessionId } = await startedSession();
    await swap(user, sessionId);
    const stranger = await createTestUser(admin, 'stranger');
    users.push(stranger);

    const mine = await user.client.rpc('session_exercises', { p_session_id: sessionId });
    const theirs = await stranger.client.rpc('session_exercises', { p_session_id: sessionId });

    expect(mine.error).toBeNull();
    expect(mine.data).toMatchObject({ revision: 1, status: 'active' });
    expect(mine.data.exercises.map((e: { exerciseId: string }) => e.exerciseId)).toEqual([ids.ok, ids.b]);
    expect(theirs.data ?? null).toBeNull();
  });

  it('keeps swaps readable only to their owner and writable by no member', async () => {
    const { user, sessionId } = await startedSession();
    await swap(user, sessionId);
    const stranger = await createTestUser(admin, 'stranger2');
    users.push(stranger);

    expect((await user.client.from('workout_session_swaps').select('id').eq('session_id', sessionId)).data).toHaveLength(1);
    expect((await stranger.client.from('workout_session_swaps').select('id').eq('session_id', sessionId)).data).toEqual([]);
    expect((await user.client.from('workout_session_swaps').insert({ session_id: sessionId, user_id: user.id, request_id: REQUEST(), revision: 9, from_exercise_id: 'x', to_exercise_id: 'y', completed_sets: 0 })).error).not.toBeNull();
  });
});
