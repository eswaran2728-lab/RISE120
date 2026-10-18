import { createAdmin, createTestClient, createTestUser, publishableKey, TestUser } from './helpers';

jest.setTimeout(180000);

const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'A. Coach', role: 'Certified strength coach', reviewedOn: '2026-10-10' };
const media = { kind: 'video', source: 'Rise120 Studio', licence: 'Owned by Rise120' };

// Roadmap C1: the catalogue tables. Members can read only what is published and reviewed; they can never write;
// and the database itself refuses to publish an item that lacks a reviewer, a licence or cues.
describe('training catalogue tables (live)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  let user: TestUser;
  const ids = { published: `pub-${suffix}`, draft: `draft-${suffix}`, review: `rev-${suffix}`, session: `sess-${suffix}`, sessionDraft: `sessd-${suffix}` };

  const exerciseRow = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    version: 1,
    pattern: 'squat',
    equipment: 'home',
    name: L(id),
    cues: [L('cue one'), L('cue two')],
    regressions: [],
    alternatives: [],
    media,
    reviewer,
    status: 'published',
    ...over,
  });
  const sessionRow = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    version: 1,
    goal: 'recomp',
    level: 'beginner',
    minutes: 20,
    location: 'home',
    day_type: 'training',
    exercises: [{ exerciseId: ids.published, sets: 2, reps: 10 }],
    reviewer,
    status: 'published',
    ...over,
  });

  beforeAll(async () => {
    user = await createTestUser(admin, 'catalogue');
    const inserted = await admin.from('exercise_versions').insert([
      exerciseRow(ids.published),
      exerciseRow(ids.draft, { status: 'draft', reviewer: null, media: null, cues: [] }),
      exerciseRow(ids.review, { status: 'in_review', reviewer: null }),
    ]);
    expect(inserted.error).toBeNull();
    const sessions = await admin.from('session_templates').insert([sessionRow(ids.session), sessionRow(ids.sessionDraft, { status: 'draft', reviewer: null })]);
    expect(sessions.error).toBeNull();
  });
  afterAll(async () => {
    await admin.from('session_templates').delete().in('id', [ids.session, ids.sessionDraft]);
    await admin.from('exercise_versions').delete().in('id', [ids.published, ids.draft, ids.review]);
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  it('shows a signed-in member published exercises and sessions only', async () => {
    const exercises = (await user.client.from('exercise_versions').select('id').in('id', [ids.published, ids.draft, ids.review])).data ?? [];
    const sessions = (await user.client.from('session_templates').select('id').in('id', [ids.session, ids.sessionDraft])).data ?? [];

    expect(exercises.map((e) => e.id)).toEqual([ids.published]);
    expect(sessions.map((s) => s.id)).toEqual([ids.session]);
  });

  it('shows nothing to someone who is not signed in', async () => {
    const client = createTestClient(publishableKey); // the public key only, no sign-in

    expect((await client.from('exercise_versions').select('id').eq('id', ids.published)).data ?? []).toEqual([]);
    expect((await client.from('session_templates').select('id').eq('id', ids.session)).data ?? []).toEqual([]);
  });

  it('never lets a member write: insert, update and delete are all refused', async () => {
    const insert = await user.client.from('exercise_versions').insert(exerciseRow(`x-${suffix}`));
    const update = await user.client.from('exercise_versions').update({ status: 'draft' }).eq('id', ids.published).select('id');
    const remove = await user.client.from('exercise_versions').delete().eq('id', ids.published).select('id');
    const sessionInsert = await user.client.from('session_templates').insert(sessionRow(`y-${suffix}`));

    expect(insert.error).not.toBeNull();
    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);
    expect(remove.error !== null || (remove.data ?? []).length === 0).toBe(true);
    expect(sessionInsert.error).not.toBeNull();
    expect((await admin.from('exercise_versions').select('status').eq('id', ids.published).single()).data?.status).toBe('published');
  });

  describe('the database refuses to publish an incomplete item', () => {
    const attempt = async (over: Record<string, unknown>) => {
      const id = `bad-${suffix}-${Math.random().toString(36).slice(2, 7)}`;
      const result = await admin.from('exercise_versions').insert(exerciseRow(id, over));
      await admin.from('exercise_versions').delete().eq('id', id);
      return result.error;
    };

    it('without a reviewer', async () => expect(await attempt({ reviewer: null })).not.toBeNull());
    it('with a reviewer missing a role or date', async () => {
      expect(await attempt({ reviewer: { name: 'A', role: '', reviewedOn: '2026-10-10' } })).not.toBeNull();
      expect(await attempt({ reviewer: { name: 'A', role: 'Coach', reviewedOn: '' } })).not.toBeNull();
    });
    it('without a demonstration', async () => expect(await attempt({ media: null })).not.toBeNull());
    it('with a demonstration that has no licence', async () => expect(await attempt({ media: { kind: 'video', source: 'x', licence: '' } })).not.toBeNull());
    it('with fewer than two cues', async () => expect(await attempt({ cues: [L('only one')] })).not.toBeNull());
    it('with an unknown movement pattern, equipment or status', async () => {
      expect(await attempt({ pattern: 'juggling' })).not.toBeNull();
      expect(await attempt({ equipment: 'yacht' })).not.toBeNull();
      expect(await attempt({ status: 'approved' })).not.toBeNull();
    });
    it('twice with the same id and version', async () => {
      const duplicate = await admin.from('exercise_versions').insert(exerciseRow(ids.published));
      expect(duplicate.error).not.toBeNull();
    });
    it('a session without a reviewer, or with a length that is not allowed', async () => {
      const noReviewer = await admin.from('session_templates').insert(sessionRow(`nr-${suffix}`, { reviewer: null }));
      const badMinutes = await admin.from('session_templates').insert(sessionRow(`bm-${suffix}`, { minutes: 25 }));
      expect(noReviewer.error).not.toBeNull();
      expect(badMinutes.error).not.toBeNull();
    });
  });

  it('lets the service role save an incomplete draft for later review', async () => {
    const id = `ok-draft-${suffix}`;
    const result = await admin.from('exercise_versions').insert(exerciseRow(id, { status: 'draft', reviewer: null, media: null, cues: [] }));
    await admin.from('exercise_versions').delete().eq('id', id);

    expect(result.error).toBeNull();
  });
});
