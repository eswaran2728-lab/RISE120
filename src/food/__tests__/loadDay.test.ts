import { mockStore } from '../../sync/testing/storageMock';
import { enqueue } from '../../sync/queue';
import { supabase } from '../../lib/supabase';
import { rememberFoods } from '../cache';
import { loadFoodDay } from '../loadDay';
import type { FoodLogOperation } from '../../sync/types';
import type { Food } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const foodRow = (id: string, calories = 200) => ({
  id, user_id: null, name: `Food ${id}`, aliases: {}, serving_desc: '1', calories, protein_g: 10, carbs_g: 20, fat_g: 5,
  source: 'usda', verified: false, region: null, source_id: null, barcode: null,
});
const logRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id, log_date: '2026-10-13', food_id: 'a', quantity: 1, meal_type: 'lunch', foods: foodRow('a'), ...extra,
});

const food = (id: string): Food => ({
  id, userId: null, name: `Food ${id}`, aliases: {}, servingDesc: '1', calories: 200, proteinG: 10, carbsG: 20, fatG: 5,
  source: 'usda', verified: false, region: null, sourceId: null, barcode: null,
});

const pendingOp = (id: string, extra: Partial<FoodLogOperation> = {}): FoodLogOperation => ({
  kind: 'food_log', id, date: '2026-10-13', foodId: 'a', quantity: 1, mealType: 'lunch', deleted: false, food: food('a'), updatedAt: 1, ...extra,
});

const order = jest.fn();
const eqCalls: [string, unknown][] = [];

function mockServer(result: unknown) {
  eqCalls.length = 0;
  order.mockImplementation(async () => result);
  const builder: Record<string, unknown> = {};
  builder.eq = (column: string, value: unknown) => {
    eqCalls.push([column, value]);
    return eqCalls.length === 2 ? { order } : builder;
  };
  (supabase.from as jest.Mock).mockReturnValue({ select: () => builder });
}

describe('loadFoodDay', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('reads this user logs for the date with each food joined', async () => {
    mockServer({ data: [logRow('s1')], error: null });

    const day = await loadFoodDay('u1', '2026-10-13');

    expect(supabase.from).toHaveBeenCalledWith('food_logs');
    expect(eqCalls).toEqual([['user_id', 'u1'], ['log_date', '2026-10-13']]);
    expect(day.entries[0]).toMatchObject({ id: 's1', quantity: 1, mealType: 'lunch', pending: false });
    expect(day.entries[0].food).toMatchObject({ id: 'a', calories: 200 });
    expect(day.totals.calories).toBe(200);
  });

  it('merges pending logs once, with an edit replacing the synced quantity', async () => {
    mockServer({ data: [logRow('s1', { quantity: 1 })], error: null });
    await enqueue('u1', pendingOp('s1', { quantity: 2 }));
    await enqueue('u1', pendingOp('p1', { mealType: 'snack' }));

    const day = await loadFoodDay('u1', '2026-10-13');

    expect(day.entries.map((e) => [e.id, e.quantity])).toEqual([['s1', 2], ['p1', 1]]);
    expect(day.totals.calories).toBe(600);
  });

  it('hides a log with a pending delete', async () => {
    mockServer({ data: [logRow('s1')], error: null });
    await enqueue('u1', pendingOp('s1', { deleted: true }));

    expect((await loadFoodDay('u1', '2026-10-13')).entries).toEqual([]);
  });

  it('falls back to the last synced logs for that date plus pending ones when offline', async () => {
    mockServer({ data: [logRow('s1')], error: null });
    await loadFoodDay('u1', '2026-10-13'); // online: remembers the synced day
    mockServer({ data: null, error: { message: 'Network request failed' } });
    await enqueue('u1', pendingOp('p1'));

    const day = await loadFoodDay('u1', '2026-10-13');

    expect(day.entries.map((e) => e.id)).toEqual(['s1', 'p1']);
    expect(day.totals.calories).toBe(400);
  });

  it('also falls back when the request throws', async () => {
    mockServer({ data: [logRow('s1')], error: null });
    await loadFoodDay('u1', '2026-10-13');
    order.mockRejectedValue(new Error('Network request failed'));

    expect((await loadFoodDay('u1', '2026-10-13')).entries.map((e) => e.id)).toEqual(['s1']);
  });

  it('does not show another day or another account remembered logs offline', async () => {
    mockServer({ data: [logRow('s1')], error: null });
    await loadFoodDay('u1', '2026-10-13');
    mockServer({ data: null, error: { message: 'Network request failed' } });

    expect((await loadFoodDay('u1', '2026-10-14')).entries).toEqual([]);
    expect((await loadFoodDay('u2', '2026-10-13')).entries).toEqual([]);
  });

  it('never includes another account pending logs', async () => {
    mockServer({ data: [], error: null });
    await enqueue('u2', pendingOp('other'));

    expect((await loadFoodDay('u1', '2026-10-13')).entries).toEqual([]);
  });

  it('resolves a pending log that lost its snapshot from recent foods, else flags it', async () => {
    mockServer({ data: [], error: null });
    await enqueue('u1', pendingOp('p1', { food: null, foodId: 'a' }));
    await enqueue('u1', pendingOp('p2', { food: null, foodId: 'unknown' }));
    await rememberFoods('u1', [food('a')]);

    const day = await loadFoodDay('u1', '2026-10-13');

    expect(day.entries.find((e) => e.id === 'p1')?.food?.id).toBe('a');
    expect(day.entries.find((e) => e.id === 'p2')?.food).toBeNull();
    expect(day.incomplete).toBe(true);
  });

  it('keeps a meal on the local day it was logged for, however late it syncs', async () => {
    mockServer({ data: [logRow('late', { log_date: '2026-10-13' })], error: null });
    await enqueue('u1', pendingOp('p-yesterday', { date: '2026-10-12' }));

    expect((await loadFoodDay('u1', '2026-10-13')).entries.map((e) => e.id)).toEqual(['late']);
    expect((await loadFoodDay('u1', '2026-10-12')).entries.map((e) => e.id)).toContain('p-yesterday');
  });
});
