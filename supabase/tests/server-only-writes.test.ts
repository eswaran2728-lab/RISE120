import { createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(120000);

// Entitlements and the limit configuration decide what a user may do, so clients must not be able to write
// them at all. Row-level security already hides every row, but a refusal at the privilege level means no
// future policy mistake can expose them: the database answers "permission denied", not "0 rows".
describe('server-only tables refuse client writes outright (live)', () => {
  const admin = createAdmin();
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser(admin, 'server-only');
  });
  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  it('refuses a client update or delete of its own entitlement, and the tier is unchanged', async () => {
    const update = await user.client.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id).select();
    const del = await user.client.from('entitlements').delete().eq('user_id', user.id).select();
    const insert = await user.client.from('entitlements').insert({ user_id: user.id, tier: 'premium' }).select();

    expect(update.error?.code).toBe('42501');
    expect(del.error?.code).toBe('42501');
    expect(insert.error).not.toBeNull();
    expect((await admin.from('entitlements').select('tier').eq('user_id', user.id).single()).data?.tier).toBe('free');
  });

  it('refuses a client write to the limit configuration, and the values are unchanged', async () => {
    const before = (await admin.from('app_config').select('value').eq('key', 'ad_rewards_max_per_day').single()).data?.value;

    const update = await user.client.from('app_config').update({ value: 999 }).eq('key', 'ad_rewards_max_per_day').select();
    const del = await user.client.from('app_config').delete().eq('key', 'ad_rewards_max_per_day').select();
    const insert = await user.client.from('app_config').insert({ key: 'free_plan_days_override', value: 120 }).select();

    expect(update.error?.code).toBe('42501');
    expect(del.error?.code).toBe('42501');
    expect(insert.error).not.toBeNull();
    expect((await admin.from('app_config').select('value').eq('key', 'ad_rewards_max_per_day').single()).data?.value).toEqual(before);
  });

  it('still lets a client read its own entitlement and the configuration', async () => {
    expect((await user.client.from('entitlements').select('tier').eq('user_id', user.id)).data).toEqual([{ tier: 'free' }]);
    expect(((await user.client.from('app_config').select('key')).data ?? []).length).toBeGreaterThan(0);
  });
});
