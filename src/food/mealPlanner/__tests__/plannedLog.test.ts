import { mockStore } from '../../../sync/testing/storageMock';
import { clearPending, listPending } from '../../../sync/queue';
import { flushPending } from '../../../sync/flush';
import type { FoodLogOperation, RecipeFoodOperation, SyncTransport } from '../../../sync/types';
import { clearUserCache } from '../../../cache/userCache';
import { recentFoods } from '../../cache';
import { supabase } from '../../../lib/supabase';
import { logPlannedMeal, plannedMealLogId, recipeFoodId } from '../plannedLog';
import { recipe, withCalories } from '../testing/fixtures';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../../lib/supabase', () => ({ supabase: { from: jest.fn(), auth: { getSession: jest.fn() } } }));

const input = (over: Record<string, unknown> = {}) => ({ recipe: recipe('bowl'), servings: 1.5, mealType: 'dinner' as const, slotKey: '0:2', confirmed: true, ...over });
const kinds = async (user: string) => (await listPending(user)).map((op) => op.kind);

// A transport that behaves like the server for the two operations a first recipe log needs.
function fakeServer() {
  const foods = new Map<string, RecipeFoodOperation>();
  const logs = new Map<string, FoodLogOperation>();
  const calls: string[] = [];
  const transport = {
    upsertRecipeFood: jest.fn(async (userId: string, op: RecipeFoodOperation) => {
      calls.push(`food:${userId}`);
      const key = `${userId}:${op.food.sourceId}`;
      if (!foods.has(key)) foods.set(key, op);
      return foods.get(key)!.id;
    }),
    upsertFoodLog: jest.fn(async (userId: string, op: FoodLogOperation) => {
      calls.push(`log:${userId}`);
      if (![...foods.values()].some((f) => f.id === op.foodId)) throw new Error('foreign key violation'); // a log of a food the server does not have
      logs.set(`${userId}:${op.id}`, op);
    }),
    deleteFoodLog: jest.fn(async () => undefined),
    upsertWorkoutSet: jest.fn(async () => undefined),
    upsertCheckin: jest.fn(async () => undefined),
  } as unknown as SyncTransport;
  return { foods, logs, calls, transport };
}

beforeEach(() => {
  mockStore.clear();
  (supabase.from as jest.Mock).mockReset();
});

describe('logPlannedMeal: only after an explicit confirmation', () => {
  it('does nothing at all when the member has not confirmed', async () => {
    expect(await logPlannedMeal('A', '2026-10-19', input({ confirmed: false }))).toEqual({ kind: 'not_confirmed' });
    expect(await listPending('A')).toEqual([]);
  });

  it('refuses a recipe whose nutrition is incomplete, because the log needs real numbers, never zeros', async () => {
    expect(await logPlannedMeal('A', '2026-10-19', input({ recipe: recipe('x', { nutrition: withCalories(null) }) }))).toEqual({ kind: 'nutrition_unknown' });
    expect(await logPlannedMeal('A', '2026-10-19', input({ recipe: recipe('y', { nutrition: null }) }))).toEqual({ kind: 'nutrition_unknown' });
    expect(await listPending('A')).toEqual([]);
  });
});

describe('logPlannedMeal: the first log of a cached recipe works with no connection', () => {
  it('queues the private, unverified recipe food and then the log, with stable ids, without touching the network', async () => {
    const result = await logPlannedMeal('A', '2026-10-19', input());

    expect(supabase.from).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'logged', logId: plannedMealLogId('A', { date: '2026-10-19', recipeId: 'bowl', mealType: 'dinner', slotKey: '0:2' }) });
    const [foodOp, logOp] = (await listPending('A')) as [RecipeFoodOperation, FoodLogOperation];
    expect(foodOp).toMatchObject({ kind: 'recipe_food', id: recipeFoodId('A', recipe('bowl')) });
    expect(foodOp.food).toMatchObject({ userId: 'A', source: 'recipe', sourceId: 'bowl@1', verified: false, calories: 500, proteinG: 25, carbsG: 60, fatG: 14 });
    expect(logOp).toMatchObject({ kind: 'food_log', foodId: foodOp.id, quantity: 1.5, mealType: 'dinner', deleted: false });
    expect(logOp.food).toMatchObject({ source: 'recipe', verified: false });
  });

  it('keeps the recipe version in the source id, so another version is another food', async () => {
    await logPlannedMeal('A', '2026-10-19', input());
    await logPlannedMeal('A', '2026-10-19', input({ recipe: recipe('bowl', { version: 2 }), slotKey: '0:3' }));

    const foods = (await listPending('A')).filter((op): op is RecipeFoodOperation => op.kind === 'recipe_food');
    expect(foods.map((f) => f.food.sourceId).sort()).toEqual(['bowl@1', 'bowl@2']);
    expect(foods[0].id).not.toBe(foods[1].id);
  });

  it('never makes the recipe or the food shared or verified, whatever the recipe says', async () => {
    await logPlannedMeal('A', '2026-10-19', input({ recipe: recipe('bowl', { status: 'published', userId: null }) }));

    const [foodOp] = (await listPending('A')) as RecipeFoodOperation[];
    expect(foodOp.food.userId).toBe('A');
    expect(foodOp.food.verified).toBe(false);
  });

  it('is one food and one log when the confirm is tapped repeatedly or repeated after a restart', async () => {
    const first = await logPlannedMeal('A', '2026-10-19', input());
    const second = await logPlannedMeal('A', '2026-10-19', input({ servings: 2 })); // edited portion: the same log, updated

    expect((second as { logId: string }).logId).toBe((first as { logId: string }).logId);
    expect(await kinds('A')).toEqual(['recipe_food', 'food_log']);
    expect(await listPending('A')).toEqual([expect.anything(), expect.objectContaining({ quantity: 2 })]);
  });

  it('shows the meal on the day before it syncs: the remembered food carries source and version', async () => {
    await logPlannedMeal('A', '2026-10-19', input());

    expect(await recentFoods('A')).toEqual([expect.objectContaining({ source: 'recipe', sourceId: 'bowl@1', verified: false })]);
  });

  it('gives different log ids for different slots, days or meals, and a stable one for the same', () => {
    const id = (over: Record<string, string> = {}) => plannedMealLogId('A', { date: '2026-10-19', recipeId: 'bowl', mealType: 'dinner', slotKey: '0:2', ...over });

    expect(id()).toBe(id());
    expect(id({ slotKey: '0:3' })).not.toBe(id());
    expect(id({ date: '2026-10-20' })).not.toBe(id());
    expect(id({ mealType: 'lunch' })).not.toBe(id());
    expect(plannedMealLogId('B', { date: '2026-10-19', recipeId: 'bowl', mealType: 'dinner', slotKey: '0:2' })).not.toBe(id());
  });

  it('queues a second log of the same recipe without a second food', async () => {
    await logPlannedMeal('A', '2026-10-19', input());
    await logPlannedMeal('A', '2026-10-19', input({ slotKey: '1:2' }));

    expect(await kinds('A')).toEqual(['recipe_food', 'food_log', 'food_log']);
  });
});

describe('logPlannedMeal: when the phone reconnects', () => {
  it('creates the food, then syncs the log, once', async () => {
    const server = fakeServer();
    await logPlannedMeal('A', '2026-10-19', input());

    const result = await flushPending('A', server.transport);

    expect(server.calls).toEqual(['food:A', 'log:A']);
    expect(result).toEqual({ synced: 2, failed: 0, remaining: 0 });
    expect(server.foods.size).toBe(1);
    expect(server.logs.size).toBe(1);
  });

  it('keeps the log waiting when creating the food fails (partial sync failure), then finishes without duplicates', async () => {
    const server = fakeServer();
    (server.transport.upsertRecipeFood as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));
    await logPlannedMeal('A', '2026-10-19', input());

    await flushPending('A', server.transport);
    expect(server.logs.size).toBe(0);
    expect(await kinds('A')).toEqual(['recipe_food', 'food_log']);
    await flushPending('A', server.transport);

    expect(server.foods.size).toBe(1);
    expect(server.logs.size).toBe(1);
    expect(await listPending('A')).toEqual([]);
  });

  it('keeps the food queued when the log fails after the food was created, and does not create a second food on retry', async () => {
    const server = fakeServer();
    (server.transport.upsertFoodLog as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));
    await logPlannedMeal('A', '2026-10-19', input());

    await flushPending('A', server.transport);
    expect(await kinds('A')).toEqual(['food_log']);
    await flushPending('A', server.transport);

    expect(server.foods.size).toBe(1);
    expect(server.logs.size).toBe(1);
  });

  it('is still one food and one log when the answer to the food was lost', async () => {
    const server = fakeServer();
    const real = server.transport.upsertRecipeFood as jest.Mock;
    const stored = real.getMockImplementation()!;
    real.mockImplementationOnce(async (userId: string, op: RecipeFoodOperation) => {
      await stored(userId, op);
      throw new Error('Network request failed');
    });
    await logPlannedMeal('A', '2026-10-19', input());

    await flushPending('A', server.transport);
    await flushPending('A', server.transport);

    expect(server.foods.size).toBe(1);
    expect(server.logs.size).toBe(1);
  });
});

describe('logPlannedMeal: accounts and deletion', () => {
  it('keeps accounts apart: each account queues its own food under its own id', async () => {
    await logPlannedMeal('A', '2026-10-19', input());
    expect(await listPending('B')).toEqual([]);

    await logPlannedMeal('B', '2026-10-19', input());

    const a = (await listPending('A'))[0] as RecipeFoodOperation;
    const b = (await listPending('B'))[0] as RecipeFoodOperation;
    expect(a.id).not.toBe(b.id);
    expect(a.food.userId).toBe('A');
    expect(b.food.userId).toBe('B');
  });

  it('does not send the first account queue while another account is signed in', async () => {
    const server = fakeServer();
    await logPlannedMeal('A', '2026-10-19', input());

    await flushPending('B', server.transport);

    expect(server.calls).toEqual([]);
    expect(await kinds('A')).toEqual(['recipe_food', 'food_log']);
  });

  it('is removed with the account: deleting the account clears the queued food and log and the remembered food', async () => {
    await logPlannedMeal('A', '2026-10-19', input());
    await logPlannedMeal('B', '2026-10-19', input());

    await clearPending('A');
    await clearUserCache('A');

    expect(await listPending('A')).toEqual([]);
    expect(await recentFoods('A')).toEqual([]);
    expect(await kinds('B')).toEqual(['recipe_food', 'food_log']);
  });
});
