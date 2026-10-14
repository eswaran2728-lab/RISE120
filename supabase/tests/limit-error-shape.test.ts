import { createAdmin, createTestUser, TestUser } from './helpers';
import { quotaErrorFrom } from '../../src/monetization/errors';

jest.setTimeout(120000);

// The app maps the database refusal to a pending reason. This checks the real error PostgREST returns for
// the same upsert the app sends, so the mapping is not only tested against a hand-written error.
describe('real FOOD_LIMIT_REACHED error as the app receives it (live)', () => {
  const admin = createAdmin();
  let user: TestUser;
  let foodId: string;

  beforeAll(async () => {
    user = await createTestUser(admin, 'limit-shape');
    foodId = (
      await admin
        .from('foods')
        .insert({ name: `Shape ${Date.now()}`, serving_desc: '1', calories: 100, protein_g: 5, carbs_g: 15, fat_g: 2, user_id: null, source: 'usda', verified: false, source_id: `shape-${Date.now()}` })
        .select('id')
        .single()
    ).data!.id;
  });
  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
    if (foodId) await admin.from('foods').delete().eq('id', foodId);
  });

  const upsertLog = (id: string) =>
    user.client
      .from('food_logs')
      .upsert({ id, user_id: user.id, log_date: new Date().toISOString().slice(0, 10), food_id: foodId, quantity: 1, meal_type: 'lunch' }, { onConflict: 'id' });

  it('carries the next UTC midnight as a hint the app turns into resetsAt, and a re-sent id is still accepted', async () => {
    // Insert until the server refuses (the limit is server config, so no number is assumed here).
    const ids: string[] = [];
    const first = crypto.randomUUID();
    let refused = await upsertLog(first);
    while (!refused.error && ids.length < 20) {
      ids.push('accepted');
      refused = await upsertLog(crypto.randomUUID());
    }
    expect(ids.length).toBeLessThan(20);

    const quota = quotaErrorFrom(refused.error);
    expect(quota).not.toBeNull();
    const tomorrow = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`).getTime() + 86400000;
    expect(quota?.reason).toEqual({ kind: 'limit', limit: 'food', resetsAt: new Date(tomorrow).toISOString() });

    // Re-sending a log that already exists (a retry after a lost response) spends no slot and is not refused.
    expect((await upsertLog(first)).error).toBeNull();
  });
});
