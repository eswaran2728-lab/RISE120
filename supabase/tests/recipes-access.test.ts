import { createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(180000);

// SYNTHETIC recipes and foods only. Members may keep private recipes of their own; only the service role writes shared
// ones; and a client can never promote an unreviewed recipe to published or verified.
const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'Fixture Reviewer', role: 'Fixture role', reviewedOn: '2000-01-01' };
const nutrition = { perServing: { calories: 300, proteinG: 10, carbsG: 45, fatG: 7, fibreG: null, sugarG: null, sodiumMg: null }, provenance: { name: 'Fixture source', url: null, recordId: null, version: '1', accessedOn: '2000-01-02', licenceEvidence: 'Fixture evidence' } };

describe('recipes (live)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  const source = `fx-${suffix}`;
  const users: TestUser[] = [];
  let a: TestUser;
  let b: TestUser;
  const ids = (n: string) => `rcp-${suffix}-${n}`;

  const row = (n: string, over: Record<string, unknown> = {}) => ({
    id: ids(n), version: 1, status: 'draft', verified: false, region: 'MY', name: L(n), servings: 2,
    ingredients: [{ ref: { source, sourceId: 'rice' }, name: 'rice', amount: 200, unit: 'g', tags: [] }],
    preparation: [L('Cook.')], prep_minutes: 5, cook_minutes: 10, cooking: ['stovetop'], nutrition: null, price: null, ...over,
  });
  const food = (userId: string | null, sourceId: string) => ({ user_id: userId, name: sourceId, serving_desc: '1 serving', calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1, source, source_id: sourceId });
  const mine = (user: TestUser, n: string, over: Record<string, unknown> = {}) => row(n, { user_id: user.id, status: 'private', ...over });

  beforeAll(async () => {
    a = await createTestUser(admin, 'rcp-a');
    b = await createTestUser(admin, 'rcp-b');
    users.push(a, b);
    expect((await admin.from('foods').insert([food(null, 'rice'), food(a.id, 'a-secret'), food(b.id, 'b-secret')])).error).toBeNull();
  });
  afterAll(async () => {
    await admin.from('recipes').delete().like('id', `rcp-${suffix}-%`);
    await admin.from('foods').delete().eq('source', source);
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });

  it('lets a member keep a private recipe of their own, and no one else read it', async () => {
    expect((await a.client.from('recipes').insert(mine(a, 'own'))).error).toBeNull();

    expect((await a.client.from('recipes').select('id').eq('id', ids('own'))).data).toHaveLength(1);
    expect((await b.client.from('recipes').select('id').eq('id', ids('own'))).data).toEqual([]);
  });

  it('shows members only published shared recipes, never drafts or recipes in review', async () => {
    expect((await admin.from('recipes').insert([row('pub', { status: 'published', reviewer, nutrition }), row('draft'), row('review', { status: 'in_review' })])).error).toBeNull();

    const seen = (await a.client.from('recipes').select('id').like('id', `rcp-${suffix}-%`)).data!.map((r: { id: string }) => r.id);

    expect(seen).toContain(ids('pub'));
    expect(seen).not.toContain(ids('draft'));
    expect(seen).not.toContain(ids('review'));
  });

  it.each([
    ['a published recipe', { status: 'published', reviewer, nutrition }],
    ['a verified recipe', { verified: true }],
    ['a recipe with a reviewer', { reviewer }],
    ['a recipe with a publication time', { published_at: new Date().toISOString() }],
    ['an unreviewed draft status', { status: 'draft' }],
  ])('refuses a client inserting %s', async (_name, over) => {
    const result = await a.client.from('recipes').insert(mine(a, `bad-${Math.random().toString(36).slice(2, 7)}`, over));

    expect(result.error).not.toBeNull();
  });

  it('refuses a client inserting a shared recipe (no owner) or one owned by someone else', async () => {
    expect((await a.client.from('recipes').insert(row('shared-by-client', { status: 'draft' }))).error).not.toBeNull();
    expect((await a.client.from('recipes').insert(mine(b, 'for-b'))).error).not.toBeNull();
  });

  it('refuses a client promoting its own private recipe to published, verified, shared or reviewed', async () => {
    expect((await a.client.from('recipes').insert(mine(a, 'promote'))).error).toBeNull();

    for (const change of [{ status: 'published' }, { verified: true }, { user_id: null }, { reviewer }, { status: 'draft' }]) {
      await a.client.from('recipes').update(change).eq('id', ids('promote'));
    }

    const stored = (await admin.from('recipes').select('status, verified, user_id, reviewer, published_at').eq('id', ids('promote')).single()).data!;
    expect(stored).toMatchObject({ status: 'private', verified: false, user_id: a.id, reviewer: null, published_at: null });
  });

  it('lets a member edit and delete only their own private recipe', async () => {
    expect((await a.client.from('recipes').insert(mine(a, 'edit'))).error).toBeNull();

    await a.client.from('recipes').update({ servings: 4 }).eq('id', ids('edit'));
    await b.client.from('recipes').update({ servings: 9 }).eq('id', ids('edit'));
    await b.client.from('recipes').delete().eq('id', ids('edit'));

    expect(Number((await admin.from('recipes').select('servings').eq('id', ids('edit')).single()).data!.servings)).toBe(4);
    await a.client.from('recipes').delete().eq('id', ids('edit'));
    expect((await admin.from('recipes').select('id').eq('id', ids('edit'))).data).toEqual([]);
  });

  it('refuses publishing without a reviewer, all three names, preparation steps, or a nutrition source with its version and licence evidence', async () => {
    const bad = [
      row('p1', { status: 'published', nutrition }),
      row('p2', { status: 'published', reviewer, nutrition, name: { en: 'x', ms: '', ta: 'x' } }),
      row('p3', { status: 'published', reviewer, nutrition, preparation: [] }),
      row('p4', { status: 'published', reviewer, nutrition: null }),
      row('p5', { status: 'published', reviewer, nutrition: { ...nutrition, provenance: { ...nutrition.provenance, version: '' } } }),
      row('p6', { status: 'published', reviewer, nutrition: { ...nutrition, provenance: { ...nutrition.provenance, licenceEvidence: ' ' } } }),
    ];

    for (const r of bad) expect((await admin.from('recipes').insert(r)).error).not.toBeNull();
    expect((await admin.from('recipes').insert(row('verified-draft', { verified: true }))).error).not.toBeNull();
  });

  it('refuses a price in a currency other than the regions, or a malformed one', async () => {
    const price = { amount: 5, currency: 'MYR', pricedOn: '2000-01-03', servings: 2, source: 'Fixture' };

    expect((await admin.from('recipes').insert(row('price-ok', { price }))).error).toBeNull();
    expect((await admin.from('recipes').insert(row('price-usd', { price: { ...price, currency: 'USD' } }))).error).not.toBeNull();
    expect((await admin.from('recipes').insert(row('price-bad', { price: { ...price, currency: 'ringgit' } }))).error).not.toBeNull();
    expect((await admin.from('recipes').insert(row('price-neg', { price: { ...price, amount: -1 } }))).error).not.toBeNull();
  });

  it('makes a duplicate import of the same shared recipe version fail, but allows a new version', async () => {
    expect((await admin.from('recipes').insert(row('dup'))).error).toBeNull();

    expect((await admin.from('recipes').insert(row('dup'))).error).not.toBeNull();
    expect((await admin.from('recipes').insert(row('dup', { version: 2 }))).error).toBeNull();
  });

  it('lets two accounts keep a private recipe with the same id, but not the same account twice', async () => {
    expect((await a.client.from('recipes').insert(mine(a, 'same'))).error).toBeNull();
    expect((await b.client.from('recipes').insert(mine(b, 'same'))).error).toBeNull();
    expect((await a.client.from('recipes').insert(mine(a, 'same'))).error).not.toBeNull();
  });

  it('lets a shared published recipe use only shared foods', async () => {
    const shared = row('ref-shared', { status: 'published', reviewer, nutrition });
    const usesPrivate = row('ref-private', { status: 'published', reviewer, nutrition, ingredients: [{ ref: { source, sourceId: 'a-secret' }, name: 'x', amount: 1, unit: 'g', tags: [] }] });
    const usesUnknown = row('ref-unknown', { status: 'published', reviewer, nutrition, ingredients: [{ ref: { source, sourceId: 'no-such-food' }, name: 'x', amount: 1, unit: 'g', tags: [] }] });

    expect((await admin.from('recipes').insert(shared)).error).toBeNull();
    expect((await admin.from('recipes').insert(usesPrivate)).error).not.toBeNull();
    expect((await admin.from('recipes').insert(usesUnknown)).error).not.toBeNull();
  });

  it('lets a private recipe use shared foods and its own, never another accounts food', async () => {
    const withFood = (sourceId: string) => [{ ref: { source, sourceId }, name: 'x', amount: 1, unit: 'g', tags: [] }];

    expect((await a.client.from('recipes').insert(mine(a, 'uses-own', { ingredients: withFood('a-secret') }))).error).toBeNull();
    expect((await a.client.from('recipes').insert(mine(a, 'uses-shared', { ingredients: withFood('rice') }))).error).toBeNull();
    expect((await a.client.from('recipes').insert(mine(a, 'uses-theirs', { ingredients: withFood('b-secret') }))).error).not.toBeNull();
  });

  it('deletes a private recipe with its account', async () => {
    const gone = await createTestUser(admin, 'rcp-gone');
    expect((await gone.client.from('recipes').insert(mine(gone, 'with-account'))).error).toBeNull();

    await admin.auth.admin.deleteUser(gone.id);

    expect((await admin.from('recipes').select('id').eq('id', ids('with-account'))).data).toEqual([]);
  });
});
