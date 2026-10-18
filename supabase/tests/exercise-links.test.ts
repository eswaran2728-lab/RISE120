import { callFunction, createAdmin, createTestUser, TestUser } from './helpers';
import { buildPlanDays, NUTRITION_RULES } from '../functions/_shared/plan/generate';

jest.setTimeout(300000);

const utcDate = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'A. Coach', role: 'Certified strength coach', reviewedOn: '2026-10-10' };
const media = { kind: 'video', source: 'Rise120 Studio', licence: 'Owned by Rise120' };

// Roadmap C3 (link): a reviewed catalogue exercise maps to one row of the exercise table the logs already use, and
// a logged set can say which started session it belongs to. Old logs, history and progress are untouched.
describe('catalogue-to-log exercise links (live)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  const users: TestUser[] = [];
  const ids = { a: `el-a-${suffix}`, b: `el-b-${suffix}`, template: `el-t-${suffix}` };
  let seedExercises: { id: string; name: string; muscle_group: string; equipment: string; instructions: string }[] = [];

  beforeAll(async () => {
    seedExercises = (await admin.from('exercises').select('id, name, muscle_group, equipment, instructions')).data ?? [];
    const exercise = (id: string, alt: string) => ({ id, version: 1, pattern: 'squat', equipment: 'none', name: L(id), cues: [L('one'), L('two')], regressions: [], alternatives: [alt], media, reviewer, status: 'published' });
    expect((await admin.from('exercise_versions').insert([exercise(ids.a, ids.b), exercise(ids.b, ids.a)])).error).toBeNull();
    const template = { id: ids.template, version: 1, goal: 'recomp', level: 'beginner', minutes: 10, location: 'home', day_type: 'training', exercises: [{ exerciseId: ids.a, sets: 3, reps: 10 }], reviewer, status: 'published' };
    expect((await admin.from('session_templates').insert(template)).error).toBeNull();
  });
  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
    await admin.from('exercise_links').delete().in('catalogue_id', [ids.a, ids.b]);
    await admin.from('session_templates').delete().eq('id', ids.template);
    await admin.from('exercise_versions').delete().in('id', [ids.a, ids.b]);
  });

  const freshUser = async () => {
    const user = await createTestUser(admin, 'links');
    users.push(user);
    await admin.from('profiles').update({ age: 30, height_cm: 175, weight_kg: 70, goal: 'recomp', training_level: 'beginner', equipment: 'gym', energy_sex: 'male', activity_level: 'light', onboarded_at: new Date().toISOString() }).eq('id', user.id);
    return user;
  };
  const sessionFor = async (user: TestUser) => {
    const start = utcDate(-4);
    const days = buildPlanDays({ age: 30, heightCm: 175, weightKg: 70, goal: 'recomp', trainingLevel: 'beginner', equipment: 'gym', energySex: 'male', activityLevel: 'light' }, start, seedExercises, NUTRITION_RULES).map(({ date: _d, ...day }) => day);
    const plan = await admin.rpc('create_plan_with_days', { p_user_id: user.id, p_start_date: start, p_days: days });
    const result = await callFunction('start-session', user.jwt, { requestId: crypto.randomUUID(), planId: plan.data[0].result_plan_id, dayNumber: 5, templateId: ids.template, templateVersion: 1 });
    expect(result.status).toBe(200);
    return result.json.sessionId as string;
  };
  const log = (user: TestUser, sessionId: string | null) =>
    user.client.from('workout_logs').insert({ user_id: user.id, log_date: utcDate(0), exercise_id: seedExercises[0].id, set_number: 1, reps: 10, weight_kg: 0, session_id: sessionId });

  it('lets a member read links but never write them', async () => {
    const user = await freshUser();
    expect((await admin.from('exercise_links').insert({ catalogue_id: ids.a, exercise_id: seedExercises[0].id })).error).toBeNull();

    const read = await user.client.from('exercise_links').select('catalogue_id, exercise_id').eq('catalogue_id', ids.a);
    expect(read.data).toEqual([{ catalogue_id: ids.a, exercise_id: seedExercises[0].id }]);
    expect((await user.client.from('exercise_links').insert({ catalogue_id: ids.b, exercise_id: seedExercises[1].id })).error).not.toBeNull();
    expect((await user.client.from('exercise_links').update({ exercise_id: seedExercises[1].id }).eq('catalogue_id', ids.a)).data ?? []).toEqual([]);
    expect((await user.client.from('exercise_links').delete().eq('catalogue_id', ids.a)).data ?? []).toEqual([]);
    expect((await admin.from('exercise_links').select('exercise_id').eq('catalogue_id', ids.a).single()).data?.exercise_id).toBe(seedExercises[0].id);
  });

  it('links one catalogue exercise to one log exercise, and only to a real one', async () => {
    expect((await admin.from('exercise_links').insert({ catalogue_id: ids.a, exercise_id: seedExercises[1].id })).error).not.toBeNull(); // already linked
    expect((await admin.from('exercise_links').insert({ catalogue_id: ids.b, exercise_id: crypto.randomUUID() })).error).not.toBeNull();
    expect((await admin.from('exercise_links').insert({ catalogue_id: 'not-in-catalogue', exercise_id: seedExercises[1].id })).error).not.toBeNull();
  });

  it('lets a set belong to the owners own started session, and to none', async () => {
    const user = await freshUser();
    const sessionId = await sessionFor(user);

    expect((await log(user, sessionId)).error).toBeNull();
    expect((await log(user, null)).error).toBeNull();
  });

  it('refuses a set that points at someone elses session', async () => {
    const owner = await freshUser();
    const other = await freshUser();
    const sessionId = await sessionFor(owner);

    expect((await log(other, sessionId)).error).not.toBeNull();
    expect((await log(other, crypto.randomUUID())).error).not.toBeNull();
  });
});
