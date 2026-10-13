import { mockStore } from '../../sync/testing/storageMock';
import { listPending } from '../../sync/queue';
import { recentFoods } from '../cache';
import { newLogId, queueFoodLog, queueFoodLogDelete } from '../log';
import type { Food } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const food: Food = {
  id: 'food-1',
  userId: null,
  name: 'Nasi lemak',
  aliases: {},
  servingDesc: '1 plate',
  calories: 644,
  proteinG: 15.5,
  carbsG: 80,
  fatG: 28,
  source: 'curated',
  verified: true,
  region: 'MY',
  sourceId: null,
  barcode: null,
};

describe('newLogId', () => {
  it('returns a valid v4 UUID that differs each time', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newLogId()));

    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID);
  });
});

describe('queueFoodLog', () => {
  beforeEach(() => mockStore.clear());

  it('queues a meal log with a stable id, the food snapshot and the local date', async () => {
    const id = await queueFoodLog('u1', '2026-10-13', { food, quantity: 1.5, mealType: 'breakfast' });

    expect(id).toMatch(UUID);
    expect(await listPending('u1')).toEqual([
      expect.objectContaining({ kind: 'food_log', id, date: '2026-10-13', foodId: 'food-1', quantity: 1.5, mealType: 'breakfast', deleted: false, food }),
    ]);
  });

  it.each(['breakfast', 'lunch', 'dinner', 'snack'] as const)('accepts the %s meal', async (mealType) => {
    await expect(queueFoodLog('u1', '2026-10-13', { food, quantity: 1, mealType })).resolves.toMatch(UUID);
  });

  it('creates one pending log when the same entry id is submitted twice (double tap)', async () => {
    const id = newLogId();
    await Promise.all([
      queueFoodLog('u1', '2026-10-13', { id, food, quantity: 1, mealType: 'lunch' }),
      queueFoodLog('u1', '2026-10-13', { id, food, quantity: 1, mealType: 'lunch' }),
    ]);

    expect(await listPending('u1')).toHaveLength(1);
  });

  it('logs the same food twice as two meals when the ids differ', async () => {
    await queueFoodLog('u1', '2026-10-13', { food, quantity: 1, mealType: 'lunch' });
    await queueFoodLog('u1', '2026-10-13', { food, quantity: 1, mealType: 'lunch' });

    expect(await listPending('u1')).toHaveLength(2);
  });

  it('edits a log by reusing its id, so the latest edit replaces the earlier one', async () => {
    const id = await queueFoodLog('u1', '2026-10-13', { food, quantity: 1, mealType: 'lunch' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await queueFoodLog('u1', '2026-10-13', { id, food, quantity: 2, mealType: 'dinner' });

    const pending = await listPending('u1');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id, quantity: 2, mealType: 'dinner' });
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['over the maximum', 101],
  ])('rejects a %s quantity and queues nothing', async (_label, quantity) => {
    await expect(queueFoodLog('u1', '2026-10-13', { food, quantity, mealType: 'lunch' })).rejects.toThrow();

    expect(await listPending('u1')).toEqual([]);
  });

  it('rejects an invalid meal type or date', async () => {
    await expect(queueFoodLog('u1', '2026-10-13', { food, quantity: 1, mealType: 'brunch' as never })).rejects.toThrow();
    await expect(queueFoodLog('u1', '13/10/2026', { food, quantity: 1, mealType: 'lunch' })).rejects.toThrow();

    expect(await listPending('u1')).toEqual([]);
  });

  it('remembers the food for offline search and keeps accounts separate', async () => {
    await queueFoodLog('u1', '2026-10-13', { food, quantity: 1, mealType: 'lunch' });

    expect((await recentFoods('u1')).map((f) => f.id)).toEqual(['food-1']);
    expect(await recentFoods('u2')).toEqual([]);
    expect(await listPending('u2')).toEqual([]);
  });
});

describe('queueFoodLogDelete', () => {
  beforeEach(() => mockStore.clear());

  const entry = (id: string) => ({ id, date: '2026-10-13', food, foodId: 'food-1', quantity: 1, mealType: 'lunch' as const });

  it('queues a delete tombstone that replaces a pending add of the same log', async () => {
    const id = await queueFoodLog('u1', '2026-10-13', { food, quantity: 1, mealType: 'lunch' });
    await new Promise((resolve) => setTimeout(resolve, 2));

    await queueFoodLogDelete('u1', entry(id));

    const pending = await listPending('u1');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id, deleted: true });
  });

  it('queues a tombstone for a log that already synced', async () => {
    await queueFoodLogDelete('u1', entry('server-log'));

    expect(await listPending('u1')).toEqual([expect.objectContaining({ id: 'server-log', deleted: true })]);
  });
});
