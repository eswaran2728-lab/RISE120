import { createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(180000);

// The quota day is the UTC date the server accepts a log; log_date is only the intended meal date.
const utcToday = () => new Date().toISOString().slice(0, 10);
const LIMIT_MESSAGE = 'FOOD_LIMIT_REACHED';

describe('food log quota admission in the database (live)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  let sharedFoodId: string;
  const users: TestUser[] = [];
  let originalLimit: unknown;

  beforeAll(async () => {
    const shared = await admin
      .from('foods')
      .insert({ name: `Quota shared ${suffix}`, serving_desc: '1', calories: 100, protein_g: 5, carbs_g: 15, fat_g: 2, user_id: null, source: 'usda', verified: false, source_id: `quota-${suffix}` })
      .select('id')
      .single();
    sharedFoodId = shared.data!.id;
    originalLimit = (await admin.from('app_config').select('value').eq('key', 'free_food_logs_per_day').single()).data?.value;
  });

  afterAll(async () => {
    if (originalLimit !== undefined) await admin.from('app_config').update({ value: originalLimit }).eq('key', 'free_food_logs_per_day');
    await admin.from('ad_credits').delete().in('user_id', users.map((u) => u.id));
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
    if (sharedFoodId) await admin.from('foods').delete().eq('id', sharedFoodId);
  });

  const freshUser = async (label = 'quota') => {
    const user = await createTestUser(admin, label);
    users.push(user);
    return user;
  };
  const makePremium = (user: TestUser) => admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id);
  const uuid = () => crypto.randomUUID();
  const row = (user: TestUser, extra: Record<string, unknown> = {}) => ({
    id: uuid(), user_id: user.id, log_date: utcToday(), food_id: sharedFoodId, quantity: 1, meal_type: 'lunch', ...extra,
  });
  const insert = (user: TestUser, extra: Record<string, unknown> = {}) => {
    const r = row(user, extra);
    return user.client.from('food_logs').insert(r).then((result) => ({ ...result, row: r }));
  };
  const count = async (user: TestUser) => (await admin.from('food_logs').select('id', { count: 'exact', head: true }).eq('user_id', user.id)).count ?? 0;
  const fillToLimit = async (user: TestUser, n = 3) => {
    const rows = [];
    for (let i = 0; i < n; i++) {
      const result = await insert(user);
      expect(result.error).toBeNull();
      rows.push(result.row);
    }
    return rows;
  };

  it('accepts three free food logs in a quota day and refuses the fourth with a stable error', async () => {
    const user = await freshUser();
    await fillToLimit(user);

    const fourth = await insert(user);

    expect(fourth.error?.message).toBe(LIMIT_MESSAGE);
    expect(await count(user)).toBe(3);
  });

  it('records the accepted UTC quota date and keeps usage_daily in step', async () => {
    const user = await freshUser();
    await fillToLimit(user, 2);

    const { data: logs } = await admin.from('food_logs').select('accepted_utc_date').eq('user_id', user.id);
    const { data: usage } = await admin.from('usage_daily').select('food_logs, usage_date').eq('user_id', user.id);

    expect((logs ?? []).map((l) => l.accepted_utc_date)).toEqual([utcToday(), utcToday()]);
    expect(usage).toEqual([{ food_logs: 2, usage_date: utcToday() }]);
  });

  it('lets a premium user log past the free limit', async () => {
    const user = await freshUser();
    await makePremium(user);

    for (let i = 0; i < 5; i++) expect((await insert(user)).error).toBeNull();

    expect(await count(user)).toBe(5);
  });

  it('follows a change to the configured limit (server config, not a constant)', async () => {
    const user = await freshUser();
    await admin.from('app_config').update({ value: 5 }).eq('key', 'free_food_logs_per_day');
    try {
      for (let i = 0; i < 5; i++) expect((await insert(user)).error).toBeNull();

      expect((await insert(user)).error?.message).toBe(LIMIT_MESSAGE);
    } finally {
      await admin.from('app_config').update({ value: originalLimit }).eq('key', 'free_food_logs_per_day');
    }
  });

  it('adds verified ad credits to the allowance (server-written ledger only)', async () => {
    const user = await freshUser();
    await admin.from('ad_credits').insert({ user_id: user.id, reward_type: 'food', credits: 2, quota_day: utcToday() });

    for (let i = 0; i < 5; i++) expect((await insert(user)).error).toBeNull();

    expect((await insert(user)).error?.message).toBe(LIMIT_MESSAGE);
  });

  it('ignores an ad credit for another reward type or another day', async () => {
    const user = await freshUser();
    await admin.from('ad_credits').insert([
      { user_id: user.id, reward_type: 'ai', credits: 5, quota_day: utcToday() },
      { user_id: user.id, reward_type: 'food', credits: 5, quota_day: '2020-01-01' },
    ]);
    await fillToLimit(user);

    expect((await insert(user)).error?.message).toBe(LIMIT_MESSAGE);
  });

  it('does not spend another slot for an edit or upsert of an existing log, even at the limit', async () => {
    const user = await freshUser();
    const [first] = await fillToLimit(user);

    const edit = await user.client.from('food_logs').update({ quantity: 2, meal_type: 'dinner' }).eq('id', first.id).select();
    const upsertExisting = await user.client.from('food_logs').upsert({ ...first, quantity: 4 }, { onConflict: 'id' });

    expect(edit.error).toBeNull();
    expect((edit.data ?? []).length).toBe(1);
    expect(upsertExisting.error).toBeNull();
    expect(await count(user)).toBe(3);
  });

  it('refuses an upsert of a new id at the limit', async () => {
    const user = await freshUser();
    await fillToLimit(user);

    const { error } = await user.client.from('food_logs').upsert(row(user), { onConflict: 'id' });

    expect(error?.message).toBe(LIMIT_MESSAGE);
    expect(await count(user)).toBe(3);
  });

  it('lets a lost-response retry with the same id succeed without a duplicate or a second slot', async () => {
    const user = await freshUser();
    const logs = await fillToLimit(user);

    const retry = await user.client.from('food_logs').upsert(logs[2], { onConflict: 'id' });
    const retryAsInsertThenConflict = await user.client.from('food_logs').upsert(logs[0], { onConflict: 'id', ignoreDuplicates: false });

    expect(retry.error).toBeNull();
    expect(retryAsInsertThenConflict.error).toBeNull();
    expect(await count(user)).toBe(3);
    expect((await admin.from('usage_daily').select('food_logs').eq('user_id', user.id).single()).data?.food_logs).toBe(3);
  });

  it('releases the slot when a log is deleted, and usage_daily follows', async () => {
    const user = await freshUser();
    const logs = await fillToLimit(user);

    expect((await user.client.from('food_logs').delete().eq('id', logs[0].id)).error).toBeNull();
    expect((await admin.from('usage_daily').select('food_logs').eq('user_id', user.id).single()).data?.food_logs).toBe(2);

    expect((await insert(user)).error).toBeNull();
    expect((await insert(user)).error?.message).toBe(LIMIT_MESSAGE);
  });

  it('cannot gain a slot by choosing another meal date (log_date is not the quota day)', async () => {
    const user = await freshUser();
    const logs = await fillToLimit(user);

    const past = await insert(user, { log_date: '2026-01-01' });
    const future = await insert(user, { log_date: '2030-01-01' });
    const moved = await user.client.from('food_logs').update({ log_date: '2026-02-02' }).eq('id', logs[0].id).select();

    expect(past.error?.message).toBe(LIMIT_MESSAGE);
    expect(future.error?.message).toBe(LIMIT_MESSAGE);
    expect(moved.error).toBeNull();
    expect((await admin.from('food_logs').select('accepted_utc_date').eq('id', logs[0].id).single()).data?.accepted_utc_date).toBe(utcToday());
    expect((await insert(user)).error?.message).toBe(LIMIT_MESSAGE);
  });

  it('cannot bypass the limit with a forged offline flag', async () => {
    const user = await freshUser();
    await fillToLimit(user);

    const forged = await insert(user, { offline: true });

    expect(forged.error).not.toBeNull();
    expect(await count(user)).toBe(3);
  });

  it('ignores a client-supplied accepted date on insert and refuses to change it afterwards', async () => {
    const user = await freshUser();
    const result = await insert(user, { accepted_utc_date: '2020-01-01' });
    expect(result.error).toBeNull();
    const stored = async () => (await admin.from('food_logs').select('accepted_utc_date').eq('id', result.row.id).single()).data?.accepted_utc_date;
    expect(await stored()).toBe(utcToday());

    const edit = await user.client.from('food_logs').update({ accepted_utc_date: '2020-01-01' }).eq('id', result.row.id).select();
    const upsert = await user.client.from('food_logs').upsert({ ...result.row, accepted_utc_date: '2020-01-01' }, { onConflict: 'id' });

    // A direct edit is refused. An upsert that echoes a forged date is harmless: the stored date is
    // kept, so a legitimate retry that repeats the row it was given never breaks.
    expect(edit.error).not.toBeNull();
    void upsert; // either outcome is acceptable; what matters is the stored date below
    expect(await stored()).toBe(utcToday());
  });

  it('keeps client writes to usage_daily and ad_credits denied', async () => {
    const user = await freshUser();
    await fillToLimit(user, 2);

    const credit = await user.client.from('ad_credits').insert({ user_id: user.id, reward_type: 'food', credits: 9, quota_day: utcToday() });
    const reset = await user.client.from('usage_daily').update({ food_logs: 0 }).eq('user_id', user.id).select();
    const forgedUsage = await user.client.from('usage_daily').insert({ user_id: user.id, usage_date: '2020-01-01', food_logs: 0 });

    expect(credit.error).not.toBeNull();
    expect(reset.data ?? []).toEqual([]);
    expect(forgedUsage.error).not.toBeNull();
    expect((await admin.from('usage_daily').select('food_logs').eq('user_id', user.id).single()).data?.food_logs).toBe(2);
  });

  it('lets a user read their own ad credits but not those of another user', async () => {
    const a = await freshUser('credit-a');
    const b = await freshUser('credit-b');
    await admin.from('ad_credits').insert({ user_id: a.id, reward_type: 'food', credits: 2, quota_day: utcToday() });

    expect(((await a.client.from('ad_credits').select('id')).data ?? []).length).toBe(1);
    expect((await b.client.from('ad_credits').select('id')).data ?? []).toEqual([]);
  });

  it('enforces the limit on every write path, including the service role', async () => {
    const user = await freshUser();
    await fillToLimit(user);

    const asAdmin = await admin.from('food_logs').insert(row(user));

    expect(asAdmin.error?.message).toBe(LIMIT_MESSAGE);
    expect(await count(user)).toBe(3);
  });

  it('lets only one of several simultaneous inserts take the last free slot', async () => {
    const user = await freshUser();
    await fillToLimit(user, 2);

    const results = await Promise.all(Array.from({ length: 6 }, () => insert(user)));

    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect(results.filter((r) => r.error?.message === LIMIT_MESSAGE)).toHaveLength(5);
    expect(await count(user)).toBe(3);
  });

  it('does not let a simultaneous burst by a premium user fail', async () => {
    const user = await freshUser();
    await makePremium(user);

    const results = await Promise.all(Array.from({ length: 6 }, () => insert(user)));

    expect(results.every((r) => r.error === null)).toBe(true);
  });

  it('keeps the cross-user private food protection', async () => {
    const a = await freshUser('own-a');
    const b = await freshUser('own-b');
    const bFood = (await b.client.from('foods').insert({ name: `B private ${suffix}`, serving_desc: '1', calories: 1, protein_g: 0, carbs_g: 0, fat_g: 0, user_id: b.id, source: 'custom', verified: false }).select('id').single()).data!.id;

    const { error } = await a.client.from('food_logs').insert(row(a, { food_id: bFood }));

    expect(error).not.toBeNull();
    expect(error?.message).not.toBe(LIMIT_MESSAGE);
    expect(await count(a)).toBe(0);
  });

  it("does not reveal another user's limit status when a log is spoofed for them", async () => {
    const a = await freshUser('spoof-a');
    const b = await freshUser('spoof-b');
    await fillToLimit(b);

    const { error } = await a.client.from('food_logs').insert(row(b));

    expect(error).not.toBeNull();
    expect(error?.message).not.toBe(LIMIT_MESSAGE);
  });

  it('still lets an account with quota-tracked logs be deleted', async () => {
    const user = await createTestUser(admin, 'quota-del');
    await fillToLimit(user);

    const { error } = await admin.auth.admin.deleteUser(user.id);

    expect(error).toBeNull();
    expect((await admin.from('food_logs').select('id').eq('user_id', user.id)).data).toEqual([]);
    expect((await admin.from('usage_daily').select('id').eq('user_id', user.id)).data).toEqual([]);
  });
});
