import { createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(120000);

const baseFood = {
  name: 'Test food',
  serving_desc: '1 serving',
  calories: 100,
  protein_g: 5,
  carbs_g: 15,
  fat_g: 2,
};

describe('food model, provenance and RLS (live)', () => {
  const admin = createAdmin();
  let a: TestUser;
  let b: TestUser;
  const sharedIds: string[] = [];
  const suffix = `${Date.now()}`;

  beforeAll(async () => {
    a = await createTestUser(admin, 'food-a');
    b = await createTestUser(admin, 'food-b');
  });

  afterAll(async () => {
    if (sharedIds.length) await admin.from('foods').delete().in('id', sharedIds);
    for (const user of [a, b]) if (user) await admin.auth.admin.deleteUser(user.id);
  });

  const ownFood = (user: TestUser, extra: Record<string, unknown> = {}) =>
    user.client
      .from('foods')
      .insert({ ...baseFood, user_id: user.id, source: 'custom', verified: false, ...extra })
      .select('id, user_id, source_id, barcode, aliases')
      .single();

  it('has provenance, barcode and alias columns with safe defaults', async () => {
    const { data, error } = await ownFood(a, { name: `Defaults ${suffix}` });

    expect(error).toBeNull();
    expect(data).toMatchObject({ source_id: null, barcode: null, aliases: {} });
  });

  it('lets a user store reviewed aliases and a source id on their own food', async () => {
    const { data, error } = await ownFood(a, {
      name: `Alias ${suffix}`,
      source: 'usda',
      source_id: `fdc-${suffix}`,
      aliases: { en: ['alias'], ms: ['nama'], ta: ['பெயர்'] },
    });

    expect(error).toBeNull();
    expect(data?.aliases).toEqual({ en: ['alias'], ms: ['nama'], ta: ['பெயர்'] });
  });

  it('refuses a client trying to set verified=true, or to create a shared food', async () => {
    const verified = await a.client.from('foods').insert({ ...baseFood, user_id: a.id, source: 'custom', verified: true });
    expect(verified.error).not.toBeNull();

    const shared = await a.client.from('foods').insert({ ...baseFood, user_id: null, source: 'custom', verified: false });
    expect(shared.error).not.toBeNull();
  });

  it('refuses promoting an own food to verified', async () => {
    const { data: created } = await ownFood(a, { name: `Promote ${suffix}` });

    const update = await a.client.from('foods').update({ verified: true }).eq('id', created!.id).select();

    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);
    const { data: still } = await admin.from('foods').select('verified').eq('id', created!.id).single();
    expect(still?.verified).toBe(false);
  });

  it('keeps one food per source and source id for a user, but lets two users have the same source id', async () => {
    const first = await ownFood(a, { name: `Dup1 ${suffix}`, source: 'usda', source_id: `dup-${suffix}` });
    expect(first.error).toBeNull();
    const second = await ownFood(a, { name: `Dup2 ${suffix}`, source: 'usda', source_id: `dup-${suffix}` });
    expect(second.error).not.toBeNull();

    const otherUser = await ownFood(b, { name: `Dup3 ${suffix}`, source: 'usda', source_id: `dup-${suffix}` });
    expect(otherUser.error).toBeNull();
  });

  it('keeps one shared food per source and source id', async () => {
    const row = { ...baseFood, user_id: null, source: 'curated', verified: false, source_id: `shared-${suffix}` };
    const first = await admin.from('foods').insert({ ...row, name: `Shared1 ${suffix}` }).select('id').single();
    expect(first.error).toBeNull();
    sharedIds.push(first.data!.id);

    const second = await admin.from('foods').insert({ ...row, name: `Shared2 ${suffix}` });
    expect(second.error).not.toBeNull();
  });

  it('shows a shared food to everyone but hides one user private food from another', async () => {
    const shared = await admin
      .from('foods')
      .insert({ ...baseFood, name: `Visible ${suffix}`, user_id: null, source: 'usda', verified: false, source_id: `vis-${suffix}` })
      .select('id')
      .single();
    sharedIds.push(shared.data!.id);
    const { data: privateFood } = await ownFood(a, { name: `Private ${suffix}` });

    const seenByB = await b.client.from('foods').select('id').in('id', [shared.data!.id, privateFood!.id]);
    const seenByA = await a.client.from('foods').select('id').in('id', [shared.data!.id, privateFood!.id]);

    expect((seenByB.data ?? []).map((r) => r.id)).toEqual([shared.data!.id]);
    expect((seenByA.data ?? []).map((r) => r.id).sort()).toEqual([shared.data!.id, privateFood!.id].sort());
  });

  it('does not let a user delete an own food that a meal log still references, but allows an unused one', async () => {
    const { data: logged } = await ownFood(a, { name: `Logged ${suffix}` });
    await a.client.from('food_logs').insert({ user_id: a.id, log_date: '2026-10-13', food_id: logged!.id, quantity: 1, meal_type: 'lunch' });
    const { data: unused } = await ownFood(a, { name: `Unused ${suffix}` });

    const blocked = await a.client.from('foods').delete().eq('id', logged!.id).select();
    const allowed = await a.client.from('foods').delete().eq('id', unused!.id).select();

    expect((blocked.data ?? []).length).toBe(0);
    expect((await admin.from('foods').select('id').eq('id', logged!.id)).data).toHaveLength(1);
    expect((allowed.data ?? []).length).toBe(1);
  });

  it('still lets an account with logged custom foods be deleted', async () => {
    const temp = await createTestUser(admin, 'food-del');
    const { data: food } = await temp.client
      .from('foods')
      .insert({ ...baseFood, user_id: temp.id, source: 'custom', verified: false, name: `Cascade ${suffix}` })
      .select('id')
      .single();
    await temp.client.from('food_logs').insert({ user_id: temp.id, log_date: '2026-10-13', food_id: food!.id, quantity: 1, meal_type: 'dinner' });

    const { error } = await admin.auth.admin.deleteUser(temp.id);

    expect(error).toBeNull();
    expect((await admin.from('foods').select('id').eq('id', food!.id)).data).toEqual([]);
  });
});
