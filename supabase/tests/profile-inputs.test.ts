import { SupabaseClient } from '@supabase/supabase-js';
import { createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(60000);

describe('profile energy inputs (live)', () => {
  const admin = createAdmin();
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    a = await createTestUser(admin, 'inputs-a');
    b = await createTestUser(admin, 'inputs-b');
  });

  afterAll(async () => {
    for (const user of [a, b]) if (user) await admin.auth.admin.deleteUser(user.id);
  });

  const profileOf = async (client: SupabaseClient, id: string) =>
    client.from('profiles').select('energy_sex, activity_level').eq('id', id).single();

  it('leaves existing profiles valid with both inputs null', async () => {
    const { data, error } = await profileOf(admin, a.id);

    expect(error).toBeNull();
    expect(data).toEqual({ energy_sex: null, activity_level: null });
  });

  it.each(['male', 'female', 'undisclosed'])('lets a user save energy_sex %s', async (value) => {
    const { error } = await a.client.from('profiles').update({ energy_sex: value, activity_level: 'light' }).eq('id', a.id);

    expect(error).toBeNull();
    expect((await profileOf(admin, a.id)).data).toEqual({ energy_sex: value, activity_level: 'light' });
  });

  it('rejects values outside the allowed choices', async () => {
    const { error } = await a.client.from('profiles').update({ activity_level: 'extreme' }).eq('id', a.id);

    expect(error).not.toBeNull();
  });

  it("does not let another user edit someone else's inputs", async () => {
    await admin.from('profiles').update({ energy_sex: 'female', activity_level: 'active' }).eq('id', a.id);

    const { data } = await b.client.from('profiles').update({ energy_sex: 'male' }).eq('id', a.id).select();

    expect(data ?? []).toEqual([]);
    expect((await profileOf(admin, a.id)).data?.energy_sex).toBe('female');
  });
});
