import { callFunction, createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(240000);

// SYNTHETIC reviewed recipes only. Saving a meal plan is a premium capability enforced by the server; it needs the
// revision the screen saw, answers a repeat of the same request with the same result, and never creates food logs.
const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'Fixture Reviewer', role: 'Fixture role', reviewedOn: '2000-01-01' };
const nutrition = { perServing: { calories: 500, proteinG: 25, carbsG: 60, fatG: 14, fibreG: null, sugarG: null, sodiumMg: null }, provenance: { name: 'Fixture source', url: null, recordId: null, version: '1', accessedOn: '2000-01-02', licenceEvidence: 'Fixture evidence' } };

describe('meal plans (live)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  const source = `fx-${suffix}`;
  const users: TestUser[] = [];
  const ids = { good: `mp-${suffix}-good`, draft: `mp-${suffix}-draft`, mine: `mp-${suffix}-mine` };
  let premium: TestUser;
  let other: TestUser;
  let free: TestUser;

  const recipe = (id: string, over: Record<string, unknown> = {}) => ({
    id, version: 1, status: 'published', verified: false, region: 'MY', name: L(id), servings: 2,
    ingredients: [{ ref: { source, sourceId: 'rice' }, name: 'rice', amount: 200, unit: 'g', tags: [] }],
    preparation: [L('Cook.')], cooking: ['stovetop'], nutrition, reviewer, ...over,
  });
  const selection = (over: Record<string, unknown> = {}) => ({ recipeId: ids.good, version: 1, servings: 1, day: 0, slot: 0, ...over });
  const save = (user: TestUser, over: Record<string, unknown> = {}) =>
    callFunction('meal-plan', user.jwt, { requestId: crypto.randomUUID(), expectedRevision: 0, selections: [selection()], ...over });
  const planOf = async (user: TestUser) => (await admin.from('meal_plans').select('revision, selections').eq('user_id', user.id).maybeSingle()).data;
  const makePremium = async (user: TestUser) => void (await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id));

  beforeAll(async () => {
    expect((await admin.from('foods').insert({ user_id: null, name: 'rice', serving_desc: '1', calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1, source, source_id: 'rice' })).error).toBeNull();
    expect((await admin.from('recipes').insert([recipe(ids.good), recipe(ids.draft, { status: 'draft', reviewer: null, nutrition: null })])).error).toBeNull();
    premium = await createTestUser(admin, 'mp-premium');
    other = await createTestUser(admin, 'mp-other');
    free = await createTestUser(admin, 'mp-free');
    users.push(premium, other, free);
    await makePremium(premium);
    await makePremium(other);
    await admin.from('entitlements').update({ tier: 'free' }).eq('user_id', free.id);
  });
  afterAll(async () => {
    await admin.from('recipes').delete().like('id', `mp-${suffix}-%`);
    await admin.from('foods').delete().eq('source', source);
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });

  it('answers 401 without a JWT and 400 for a malformed body', async () => {
    expect((await callFunction('meal-plan', undefined, {})).status).toBe(401);
    for (const bad of [{ requestId: 'x' }, { selections: [] }, { expectedRevision: -1 }, { selections: [selection({ servings: 0 })] }, { selections: [selection({ servings: 51 })] }, { selections: [selection(), selection()] }]) {
      expect((await save(premium, bad)).status).toBe(400);
    }
  });

  it('saves a plan for a premium member and records revision 1', async () => {
    const result = await save(premium);

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ status: 'saved', revision: 1 });
    expect(await planOf(premium)).toMatchObject({ revision: 1 });
  });

  it('refuses a free member on the server and saves nothing', async () => {
    const result = await save(free);

    expect(result.status).toBe(402);
    expect(result.json.error).toBe('PREMIUM_REQUIRED');
    expect(await planOf(free)).toBeNull();
  });

  it('refuses a lapsed subscription even while the tier still says premium (database time decides)', async () => {
    const lapsed = await createTestUser(admin, 'mp-lapsed');
    users.push(lapsed);
    await makePremium(lapsed);
    await admin.from('billing_state').upsert({ user_id: lapsed.id, premium_active: true, premium_until_ms: Date.now() - 60000 });

    const result = await save(lapsed);

    expect(result.status).toBe(402);
    expect(await planOf(lapsed)).toBeNull();
  });

  it('answers a repeat of the same request with the same result and changes nothing', async () => {
    const mine = await createTestUser(admin, 'mp-replay');
    users.push(mine);
    await makePremium(mine);
    const requestId = crypto.randomUUID();

    const first = await save(mine, { requestId });
    const again = await save(mine, { requestId });

    expect(first.json).toMatchObject({ status: 'saved', revision: 1 });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ status: 'existing', revision: 1 });
    expect((await planOf(mine))!.revision).toBe(1);
  });

  it('refuses an edit made against a stale revision, with the current revision, and saves nothing', async () => {
    const mine = await createTestUser(admin, 'mp-stale');
    users.push(mine);
    await makePremium(mine);
    await save(mine); // revision 1

    const stale = await save(mine, { expectedRevision: 0, selections: [selection({ servings: 2 })] });
    const fresh = await save(mine, { expectedRevision: 1, selections: [selection({ servings: 2 })] });

    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ error: 'REVISION_CONFLICT', revision: 1 });
    expect(fresh.json).toMatchObject({ status: 'saved', revision: 2 });
    expect((await planOf(mine))!.selections).toEqual([selection({ servings: 2 })]);
  });

  it('lets only one of two simultaneous saves against the same revision win', async () => {
    const mine = await createTestUser(admin, 'mp-race');
    users.push(mine);
    await makePremium(mine);

    const [x, y] = await Promise.all([save(mine), save(mine, { selections: [selection({ servings: 2 })] })]);

    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect((await planOf(mine))!.revision).toBe(1);
  });

  it('refuses a recipe that is a draft, does not exist, or is another accounts private recipe, and saves nothing', async () => {
    const mine = await createTestUser(admin, 'mp-recipes');
    users.push(mine);
    await makePremium(mine);
    expect((await mine.client.from('recipes').insert({ ...recipe(ids.mine), user_id: mine.id, status: 'private', reviewer: null, nutrition: null })).error).toBeNull();

    for (const recipeId of [ids.draft, `mp-${suffix}-nope`, ids.mine]) {
      const result = await save(mine, { selections: [selection({ recipeId })] });
      expect(result.status).toBe(422);
      expect(result.json.error).toBe('RECIPE_UNAVAILABLE');
    }
    expect(await planOf(mine)).toBeNull();
  });

  it('keeps each accounts plan separate: another account neither reads nor changes it', async () => {
    await save(other);

    expect((await premium.client.from('meal_plans').select('user_id')).data!.every((r: { user_id: string }) => r.user_id === premium.id)).toBe(true);
    expect((await other.client.from('meal_plans').select('revision').eq('user_id', premium.id)).data).toEqual([]);
    expect((await planOf(premium))!.revision).toBeGreaterThanOrEqual(1);
  });

  it('never creates a food log: choosing a recipe is not logging it', async () => {
    const before = (await admin.from('food_logs').select('id', { count: 'exact', head: true }).eq('user_id', premium.id)).count;

    await save(premium, { expectedRevision: (await planOf(premium))!.revision });

    expect((await admin.from('food_logs').select('id', { count: 'exact', head: true }).eq('user_id', premium.id)).count).toBe(before);
  });

  it('lets a member read their own plan but never write the table directly', async () => {
    expect((await premium.client.from('meal_plans').select('revision').eq('user_id', premium.id)).data).toHaveLength(1);
    expect((await premium.client.from('meal_plans').insert({ user_id: other.id, revision: 9, selections: [] })).error).not.toBeNull();
    await premium.client.from('meal_plans').update({ revision: 99 }).eq('user_id', premium.id);
    await premium.client.from('meal_plans').delete().eq('user_id', premium.id);

    expect((await planOf(premium))!.revision).toBeLessThan(99);
    expect(await planOf(premium)).not.toBeNull();
  });
});
