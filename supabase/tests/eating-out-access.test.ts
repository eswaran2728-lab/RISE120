import { createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(180000);

// SYNTHETIC dishes only. Eating-out guidance is reviewed content: members read only published dishes and never write.
const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'Fixture Reviewer', role: 'Fixture role', reviewedOn: '2000-01-01' };
const provenance = { name: 'Fixture source', url: null, recordId: null, version: '1', accessedOn: '2000-01-02', licenceEvidence: 'Fixture evidence' };

describe('eating-out dishes (live)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  let user: TestUser;
  const id = (n: string) => `eo-${suffix}-${n}`;
  const dish = (n: string, over: Record<string, unknown> = {}) => ({
    id: id(n), version: 1, status: 'draft', region: 'MY', name: L(n), tips: [L('Ask for less sauce.')], calories_min: 400, calories_max: 700, serving_note: L('One plate'), provenance, reviewer: null, ...over,
  });

  beforeAll(async () => {
    user = await createTestUser(admin, 'eatout');
  });
  afterAll(async () => {
    await admin.from('eating_out_dishes').delete().like('id', `eo-${suffix}-%`);
    await admin.auth.admin.deleteUser(user.id);
  });

  it('shows members only published dishes, never drafts or dishes in review', async () => {
    expect((await admin.from('eating_out_dishes').insert([dish('pub', { status: 'published', reviewer }), dish('draft'), dish('review', { status: 'in_review' })])).error).toBeNull();

    const seen = (await user.client.from('eating_out_dishes').select('id').like('id', `eo-${suffix}-%`)).data!.map((r: { id: string }) => r.id);

    expect(seen).toEqual([id('pub')]);
  });

  it('lets a member read but never write, edit or delete a dish', async () => {
    expect((await user.client.from('eating_out_dishes').insert(dish('mine'))).error).not.toBeNull();
    await user.client.from('eating_out_dishes').update({ status: 'draft' }).eq('id', id('pub'));
    await user.client.from('eating_out_dishes').delete().eq('id', id('pub'));

    expect((await admin.from('eating_out_dishes').select('status').eq('id', id('pub')).single()).data!.status).toBe('published');
  });

  it('refuses publishing without a reviewer, names, tips, or a source for the calorie range', async () => {
    const bad = [
      dish('p1', { status: 'published' }),
      dish('p2', { status: 'published', reviewer, name: { en: 'x', ms: ' ', ta: 'x' } }),
      dish('p3', { status: 'published', reviewer, tips: [] }),
      dish('p4', { status: 'published', reviewer, provenance: null }),
      dish('p5', { status: 'published', reviewer, provenance: { ...provenance, licenceEvidence: ' ' } }),
    ];

    for (const d of bad) expect((await admin.from('eating_out_dishes').insert(d)).error).not.toBeNull();
  });

  it('only ever stores calories as a range with a portion note, or as unknown', async () => {
    expect((await admin.from('eating_out_dishes').insert(dish('equal', { calories_min: 500, calories_max: 500 }))).error).not.toBeNull();
    expect((await admin.from('eating_out_dishes').insert(dish('backwards', { calories_min: 700, calories_max: 400 }))).error).not.toBeNull();
    expect((await admin.from('eating_out_dishes').insert(dish('negative', { calories_min: -1, calories_max: 400 }))).error).not.toBeNull();
    expect((await admin.from('eating_out_dishes').insert(dish('half', { calories_min: null, calories_max: 400 }))).error).not.toBeNull();
    expect((await admin.from('eating_out_dishes').insert(dish('no-note', { serving_note: null }))).error).not.toBeNull();
    expect((await admin.from('eating_out_dishes').insert(dish('unknown', { calories_min: null, calories_max: null, serving_note: null, provenance: null }))).error).toBeNull();
  });

  it('makes a duplicate import of the same version fail, but allows a new version', async () => {
    expect((await admin.from('eating_out_dishes').insert(dish('dup'))).error).toBeNull();

    expect((await admin.from('eating_out_dishes').insert(dish('dup'))).error).not.toBeNull();
    expect((await admin.from('eating_out_dishes').insert(dish('dup', { version: 2 }))).error).toBeNull();
  });
});
