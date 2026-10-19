import { createRecipeFood } from '../../src/sync/recipeFoodRow';
import type { RecipeFoodOperation } from '../../src/sync/types';
import { createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(180000);

// SYNTHETIC recipe food only. The queued "create this recipe's food" operation must make exactly one private,
// unverified food however often it is replayed, must reuse a food that already exists under another id, and can
// never produce a shared or verified food.
describe('creating a recipe food from the sync queue (live)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  let a: TestUser;
  let b: TestUser;
  const users: TestUser[] = [];
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(Number(suffix.slice(-9)) * 10 + n).padStart(12, '0')}`;

  const op = (user: TestUser, sourceId: string, id: string, over: Partial<RecipeFoodOperation['food']> = {}): RecipeFoodOperation => ({
    kind: 'recipe_food',
    id,
    updatedAt: 1,
    food: { id, userId: user.id, name: `Fixture bowl ${sourceId}`, aliases: {}, servingDesc: '1 serving of Fixture bowl', calories: 500, proteinG: 25, carbsG: 60, fatG: 14, source: 'recipe', verified: false, region: 'MY', sourceId, barcode: null, ...over },
  });
  const rows = async (user: TestUser, sourceId: string) => (await admin.from('foods').select('id, user_id, verified, source, source_id, calories').eq('user_id', user.id).eq('source', 'recipe').eq('source_id', sourceId)).data!;

  beforeAll(async () => {
    a = await createTestUser(admin, 'rf-a');
    b = await createTestUser(admin, 'rf-b');
    users.push(a, b);
  });
  afterAll(async () => {
    await admin.from('foods').delete().like('source_id', `fx-${suffix}-%`);
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });

  it('creates one private, unverified food under the queued id, and replays create no second', async () => {
    const operation = op(a, `fx-${suffix}-one@1`, uuid(1));

    const first = await createRecipeFood(a.client, a.id, operation);
    const again = await createRecipeFood(a.client, a.id, operation);
    const lost = await createRecipeFood(a.client, a.id, operation);

    expect([first, again, lost]).toEqual([operation.id, operation.id, operation.id]);
    expect(await rows(a, `fx-${suffix}-one@1`)).toEqual([expect.objectContaining({ id: operation.id, user_id: a.id, verified: false, source: 'recipe', calories: 500 })]);
  });

  it('reuses a food the member already has for that recipe version under another id, and returns that id', async () => {
    const sourceId = `fx-${suffix}-two@1`;
    const existing = await createRecipeFood(a.client, a.id, op(a, sourceId, uuid(2)));

    const returned = await createRecipeFood(a.client, a.id, op(a, sourceId, uuid(3)));

    expect(returned).toBe(existing);
    expect(await rows(a, sourceId)).toHaveLength(1);
  });

  it('keeps one food per member: the same recipe version for two members is two private foods', async () => {
    const sourceId = `fx-${suffix}-three@1`;
    await createRecipeFood(a.client, a.id, op(a, sourceId, uuid(4)));
    await createRecipeFood(b.client, b.id, op(b, sourceId, uuid(5)));

    expect(await rows(a, sourceId)).toHaveLength(1);
    expect(await rows(b, sourceId)).toHaveLength(1);
    expect((await b.client.from('foods').select('id').eq('id', uuid(4))).data).toEqual([]); // not readable by the other member
  });

  it('is refused for another member: the database does not let one member create a food for someone else', async () => {
    const sourceId = `fx-${suffix}-four@1`;

    await expect(createRecipeFood(b.client, a.id, op(a, sourceId, uuid(6)))).rejects.toThrow();
    expect(await rows(a, sourceId)).toEqual([]);
  });

  it('can never create a verified food, even if the queued snapshot says so', async () => {
    const sourceId = `fx-${suffix}-five@1`;

    await createRecipeFood(a.client, a.id, op(a, sourceId, uuid(7), { verified: true }));

    expect(await rows(a, sourceId)).toEqual([expect.objectContaining({ verified: false })]);
  });

  it('refuses a food that is not a recipe food', async () => {
    await expect(createRecipeFood(a.client, a.id, op(a, `fx-${suffix}-six@1`, uuid(8), { source: 'custom' }))).rejects.toThrow('Not a recipe food');
  });
});
