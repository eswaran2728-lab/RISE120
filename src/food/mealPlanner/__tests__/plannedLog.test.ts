import { mockStore } from '../../../sync/testing/storageMock';
import { listPending } from '../../../sync/queue';
import { supabase } from '../../../lib/supabase';
import { logPlannedMeal, plannedMealLogId } from '../plannedLog';
import { recipe, withCalories } from '../testing/fixtures';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

// An in-memory foods table behind the calls the logger makes.
function fakeFoods(options: { offline?: boolean } = {}) {
  const rows: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  (supabase.from as jest.Mock).mockImplementation(() => {
    const filters: [string, unknown][] = [];
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    };
    query.maybeSingle = async () => (options.offline ? { data: null, error: { message: 'Network request failed' } } : { data: rows.find((r) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null });
    query.insert = (row: Record<string, unknown>) => {
      inserts.push(row);
      const stored = { id: `food-${inserts.length}`, aliases: {}, region: null, barcode: null, ...row };
      rows.push(stored);
      return { select: () => ({ single: async () => (options.offline ? { data: null, error: { message: 'Network request failed' } } : { data: stored, error: null }) }) };
    };
    return query;
  });
  return { rows, inserts };
}

const input = (over: Record<string, unknown> = {}) => ({ recipe: recipe('bowl'), servings: 1.5, mealType: 'dinner' as const, slotKey: '0:2', confirmed: true, ...over });

beforeEach(() => {
  mockStore.clear();
  (supabase.from as jest.Mock).mockReset();
});

describe('logPlannedMeal: only after an explicit confirmation', () => {
  it('does nothing at all when the member has not confirmed', async () => {
    const { inserts } = fakeFoods();

    expect(await logPlannedMeal('A', '2026-10-19', input({ confirmed: false }))).toEqual({ kind: 'not_confirmed' });
    expect(inserts).toEqual([]);
    expect(await listPending('A')).toEqual([]);
  });

  it('logs the meal as a private recipe food, with its source and the servings eaten', async () => {
    const { inserts } = fakeFoods();

    const result = await logPlannedMeal('A', '2026-10-19', input());

    expect(result).toMatchObject({ kind: 'logged' });
    expect(inserts).toEqual([expect.objectContaining({ user_id: 'A', source: 'recipe', source_id: 'bowl@1', verified: false, calories: 500, protein_g: 25, carbs_g: 60, fat_g: 14 })]);
    const [op] = await listPending('A');
    expect(op).toMatchObject({ kind: 'food_log', date: '2026-10-19', quantity: 1.5, mealType: 'dinner', deleted: false });
    expect((op as { food: { source: string; verified: boolean } }).food).toMatchObject({ source: 'recipe', verified: false });
  });

  it('refuses a recipe whose nutrition is incomplete, because the log needs real numbers, never zeros', async () => {
    const { inserts } = fakeFoods();

    expect(await logPlannedMeal('A', '2026-10-19', input({ recipe: recipe('x', { nutrition: withCalories(null) }) }))).toEqual({ kind: 'nutrition_unknown' });
    expect(await logPlannedMeal('A', '2026-10-19', input({ recipe: recipe('y', { nutrition: null }) }))).toEqual({ kind: 'nutrition_unknown' });
    expect(inserts).toEqual([]);
    expect(await listPending('A')).toEqual([]);
  });
});

describe('logPlannedMeal: one log however many times it is tapped', () => {
  it('uses the same log id and creates the recipe food once when saved twice', async () => {
    const { inserts } = fakeFoods();

    const first = await logPlannedMeal('A', '2026-10-19', input());
    const second = await logPlannedMeal('A', '2026-10-19', input());

    expect(first).toMatchObject({ kind: 'logged' });
    expect((second as { logId: string }).logId).toBe((first as { logId: string }).logId);
    expect(inserts).toHaveLength(1);
    expect(await listPending('A')).toHaveLength(1);
  });

  it('gives different ids for different slots, days or meals, and a stable one for the same', () => {
    const id = (over: Record<string, string> = {}) => plannedMealLogId('A', { date: '2026-10-19', recipeId: 'bowl', mealType: 'dinner', slotKey: '0:2', ...over });

    expect(id()).toBe(id());
    expect(id({ slotKey: '0:3' })).not.toBe(id());
    expect(id({ date: '2026-10-20' })).not.toBe(id());
    expect(id({ mealType: 'lunch' })).not.toBe(id());
    expect(plannedMealLogId('B', { date: '2026-10-19', recipeId: 'bowl', mealType: 'dinner', slotKey: '0:2' })).not.toBe(id());
  });

  it('keeps one log when the queue replays the same id after a restart', async () => {
    fakeFoods();
    await logPlannedMeal('A', '2026-10-19', input());

    await logPlannedMeal('A', '2026-10-19', input({ servings: 2 })); // edited portion before saving again: the same log, updated

    const ops = await listPending('A');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ quantity: 2 });
  });
});

describe('logPlannedMeal: offline and accounts', () => {
  it('says it needs a connection the first time, when the recipe food does not exist yet', async () => {
    fakeFoods({ offline: true });

    expect(await logPlannedMeal('A', '2026-10-19', input())).toEqual({ kind: 'offline' });
    expect(await listPending('A')).toEqual([]);
  });

  it('logs offline once the recipe food is remembered on this phone', async () => {
    fakeFoods();
    await logPlannedMeal('A', '2026-10-19', input());
    fakeFoods({ offline: true });

    expect(await logPlannedMeal('A', '2026-10-19', input({ slotKey: '1:2' }))).toMatchObject({ kind: 'logged' });
    expect(await listPending('A')).toHaveLength(2);
  });

  it('keeps accounts apart: another account has nothing queued and cannot use the first accounts remembered food offline', async () => {
    fakeFoods();
    await logPlannedMeal('A', '2026-10-19', input());
    fakeFoods({ offline: true });

    expect(await listPending('B')).toEqual([]);
    expect(await logPlannedMeal('B', '2026-10-19', input())).toEqual({ kind: 'offline' });
  });
});
