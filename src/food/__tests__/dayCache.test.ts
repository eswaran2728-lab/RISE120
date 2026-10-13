import { mockStore } from '../../sync/testing/storageMock';
import { readCache, writeCache } from '../../cache/userCache';
import { applyFoodLogToDayCache } from '../dayCache';
import type { SyncedLogEntry } from '../day';
import type { FoodLogOperation } from '../../sync/types';
import type { Food } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

const food: Food = {
  id: 'a', userId: null, name: 'Apple', aliases: {}, servingDesc: '1', calories: 52, proteinG: 0.3, carbsG: 14, fatG: 0.2,
  source: 'usda', verified: false, region: null, sourceId: null, barcode: null,
};

const entry = (id: string, extra: Partial<SyncedLogEntry> = {}): SyncedLogEntry => ({
  id, date: '2026-10-13', foodId: 'a', quantity: 1, mealType: 'lunch', food, ...extra,
});

const op = (id: string, extra: Partial<FoodLogOperation> = {}): FoodLogOperation => ({
  kind: 'food_log', id, date: '2026-10-13', foodId: 'a', quantity: 1, mealType: 'lunch', deleted: false, food, updatedAt: 1, ...extra,
});

const cached = (userId = 'u1') => readCache<{ date: string; entries: SyncedLogEntry[] }>(userId, 'foodDay');

describe('applyFoodLogToDayCache', () => {
  beforeEach(() => mockStore.clear());

  it('adds a synced log to the cached day', async () => {
    await writeCache('u1', 'foodDay', { date: '2026-10-13', entries: [entry('s1')] });

    await applyFoodLogToDayCache('u1', op('p1', { quantity: 2, mealType: 'dinner' }));

    expect((await cached())?.entries.map((e) => [e.id, e.quantity, e.mealType])).toEqual([['s1', 1, 'lunch'], ['p1', 2, 'dinner']]);
  });

  it('replaces an edited log instead of adding a second copy', async () => {
    await writeCache('u1', 'foodDay', { date: '2026-10-13', entries: [entry('s1', { quantity: 1 })] });

    await applyFoodLogToDayCache('u1', op('s1', { quantity: 3 }));

    expect((await cached())?.entries).toHaveLength(1);
    expect((await cached())?.entries[0].quantity).toBe(3);
  });

  it('removes a log whose delete synced', async () => {
    await writeCache('u1', 'foodDay', { date: '2026-10-13', entries: [entry('s1'), entry('s2')] });

    await applyFoodLogToDayCache('u1', op('s1', { deleted: true }));

    expect((await cached())?.entries.map((e) => e.id)).toEqual(['s2']);
  });

  it('leaves the cache alone for a different day, or when nothing is cached', async () => {
    await writeCache('u1', 'foodDay', { date: '2026-10-13', entries: [entry('s1')] });

    await applyFoodLogToDayCache('u1', op('p1', { date: '2026-10-14' }));
    await applyFoodLogToDayCache('u2', op('p1'));

    expect((await cached())?.entries.map((e) => e.id)).toEqual(['s1']);
    expect(await cached('u2')).toBeNull();
  });

  it('does not let one account change another account cache', async () => {
    await writeCache('u1', 'foodDay', { date: '2026-10-13', entries: [entry('s1')] });
    await writeCache('u2', 'foodDay', { date: '2026-10-13', entries: [] });

    await applyFoodLogToDayCache('u2', op('p1'));

    expect((await cached('u1'))?.entries.map((e) => e.id)).toEqual(['s1']);
  });
});
