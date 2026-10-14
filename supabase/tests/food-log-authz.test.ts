import { createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(120000);

const baseFood = { serving_desc: '1 serving', calories: 100, protein_g: 5, carbs_g: 15, fat_g: 2 };

describe('food log authorization (live)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  let a: TestUser;
  let b: TestUser;
  let sharedFoodId: string;
  let aFoodId: string;
  let bFoodId: string;
  const cleanupLogs: string[] = [];

  beforeAll(async () => {
    a = await createTestUser(admin, 'flog-a');
    b = await createTestUser(admin, 'flog-b');
    // These tests log more than the free daily limit for A. Quota behaviour has its own suite
    // (food-quota.test.ts), so A is premium here and only authorization is under test.
    await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', a.id);

    const shared = await admin
      .from('foods')
      .insert({ ...baseFood, name: `Shared ${suffix}`, user_id: null, source: 'usda', verified: false, source_id: `flog-${suffix}` })
      .select('id')
      .single();
    sharedFoodId = shared.data!.id;
    aFoodId = (await a.client.from('foods').insert({ ...baseFood, name: `A food ${suffix}`, user_id: a.id, source: 'custom', verified: false }).select('id').single()).data!.id;
    bFoodId = (await b.client.from('foods').insert({ ...baseFood, name: `B private ${suffix}`, user_id: b.id, source: 'custom', verified: false }).select('id').single()).data!.id;
  });

  afterAll(async () => {
    if (cleanupLogs.length) await admin.from('food_logs').delete().in('id', cleanupLogs);
    if (sharedFoodId) await admin.from('foods').delete().eq('id', sharedFoodId);
    for (const user of [a, b]) if (user) await admin.auth.admin.deleteUser(user.id);
  });

  const newId = () => `${[8, 4, 4, 4, 12].map((n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')).join('-')}`.replace(/^(.{14})./, '$14');
  const logRow = (user: TestUser, foodId: string, id = newId()) => ({ id, user_id: user.id, log_date: '2026-10-13', food_id: foodId, quantity: 1, meal_type: 'lunch' });
  const track = (id: string) => cleanupLogs.push(id);

  it('lets a user log a shared food', async () => {
    const row = logRow(a, sharedFoodId);
    const { error } = await a.client.from('food_logs').insert(row);
    track(row.id);

    expect(error).toBeNull();
  });

  it("lets a user log their own private food", async () => {
    const row = logRow(a, aFoodId);
    const { error } = await a.client.from('food_logs').insert(row);
    track(row.id);

    expect(error).toBeNull();
  });

  it('lets the same sync path used by the app (upsert on id) work for shared and own foods, and for an edit', async () => {
    const shared = logRow(a, sharedFoodId);
    const own = logRow(a, aFoodId);
    track(shared.id);
    track(own.id);

    expect((await a.client.from('food_logs').upsert(shared, { onConflict: 'id' })).error).toBeNull();
    expect((await a.client.from('food_logs').upsert(own, { onConflict: 'id' })).error).toBeNull();
    expect((await a.client.from('food_logs').upsert({ ...own, quantity: 2.5 }, { onConflict: 'id' })).error).toBeNull();

    const { data } = await admin.from('food_logs').select('quantity').eq('id', own.id).single();
    expect(Number(data?.quantity)).toBe(2.5);
  });

  it("refuses an insert that references another user's private food, even with its UUID", async () => {
    const row = logRow(a, bFoodId);
    track(row.id);

    const { error } = await a.client.from('food_logs').insert(row);

    expect(error).not.toBeNull();
    expect((await admin.from('food_logs').select('id').eq('id', row.id)).data).toEqual([]);
  });

  it("refuses an upsert (insert path) that references another user's private food", async () => {
    const row = logRow(a, bFoodId);
    track(row.id);

    const { error } = await a.client.from('food_logs').upsert(row, { onConflict: 'id' });

    expect(error).not.toBeNull();
    expect((await admin.from('food_logs').select('id').eq('id', row.id)).data).toEqual([]);
  });

  it("refuses an upsert whose update path would repoint an existing log at another user's private food", async () => {
    const mine = logRow(a, aFoodId);
    track(mine.id);
    await a.client.from('food_logs').insert(mine);

    const { error } = await a.client.from('food_logs').upsert({ ...mine, food_id: bFoodId }, { onConflict: 'id' });

    expect(error).not.toBeNull();
    expect((await admin.from('food_logs').select('food_id').eq('id', mine.id).single()).data?.food_id).toBe(aFoodId);
  });

  it("refuses an update that repoints an existing log at another user's private food", async () => {
    const mine = logRow(a, aFoodId);
    track(mine.id);
    await a.client.from('food_logs').insert(mine);

    const update = await a.client.from('food_logs').update({ food_id: bFoodId }).eq('id', mine.id).select();

    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);
    expect((await admin.from('food_logs').select('food_id').eq('id', mine.id).single()).data?.food_id).toBe(aFoodId);
  });

  it('still lets a user change the quantity and meal of an existing log', async () => {
    const mine = logRow(a, sharedFoodId);
    track(mine.id);
    await a.client.from('food_logs').insert(mine);

    const update = await a.client.from('food_logs').update({ quantity: 3, meal_type: 'dinner' }).eq('id', mine.id).select();

    expect(update.error).toBeNull();
    expect((update.data ?? []).length).toBe(1);
  });

  it('still refuses logging for another user (user_id check unchanged)', async () => {
    const row = logRow(b, sharedFoodId);
    track(row.id);

    expect((await a.client.from('food_logs').insert(row)).error).not.toBeNull();
  });

  it('keeps account deletion working for a user with logs on shared and own foods', async () => {
    const temp = await createTestUser(admin, 'flog-del');
    const own = (await temp.client.from('foods').insert({ ...baseFood, name: `Del ${suffix}`, user_id: temp.id, source: 'custom', verified: false }).select('id').single()).data!.id;
    await temp.client.from('food_logs').insert(logRow(temp, own));
    await temp.client.from('food_logs').insert(logRow(temp, sharedFoodId));

    const { error } = await admin.auth.admin.deleteUser(temp.id);

    expect(error).toBeNull();
    expect((await admin.from('food_logs').select('id').eq('user_id', temp.id)).data).toEqual([]);
  });

  it("deleting user B's private food cannot remove user A's logs, because A can no longer hold one", async () => {
    const attempt = logRow(a, bFoodId);
    track(attempt.id);
    await a.client.from('food_logs').insert(attempt);

    const crossRefs = await admin.from('food_logs').select('id').eq('food_id', bFoodId).eq('user_id', a.id);

    expect(crossRefs.data).toEqual([]);
  });
});
