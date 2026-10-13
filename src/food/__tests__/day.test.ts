import { buildFoodDay, SyncedLogEntry } from '../day';
import type { FoodLogOperation } from '../../sync/types';
import type { Food } from '../types';

const food = (id: string, extra: Partial<Food> = {}): Food => ({
  id,
  userId: null,
  name: `Food ${id}`,
  aliases: {},
  servingDesc: '1 serving',
  calories: 200,
  proteinG: 10,
  carbsG: 20,
  fatG: 5,
  source: 'usda',
  verified: false,
  region: null,
  sourceId: null,
  barcode: null,
  ...extra,
});

const synced = (id: string, extra: Partial<SyncedLogEntry> = {}): SyncedLogEntry => ({
  id,
  date: '2026-10-13',
  foodId: 'a',
  quantity: 1,
  mealType: 'lunch',
  food: food('a'),
  ...extra,
});

const pending = (id: string, extra: Partial<FoodLogOperation> = {}): FoodLogOperation => ({
  kind: 'food_log',
  id,
  date: '2026-10-13',
  foodId: 'a',
  quantity: 1,
  mealType: 'lunch',
  deleted: false,
  food: food('a'),
  updatedAt: 1,
  ...extra,
});

const build = (s: SyncedLogEntry[], p: FoodLogOperation[], known: Food[] = []) =>
  buildFoodDay({ date: '2026-10-13', synced: s, pending: p, knownFoods: known });

describe('buildFoodDay', () => {
  it('is empty with no entries', () => {
    const day = build([], []);

    expect(day.entries).toEqual([]);
    expect(day.totals).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
    expect(day.incomplete).toBe(false);
  });

  it('computes consumed totals from food values times quantity, by meal and for the day', () => {
    const day = build(
      [synced('s1', { mealType: 'breakfast', quantity: 1.5 }), synced('s2', { mealType: 'lunch', quantity: 2 })],
      [pending('p1', { mealType: 'snack', quantity: 0.5 })]
    );

    expect(day.byMeal.breakfast.totals).toEqual({ calories: 300, proteinG: 15, carbsG: 30, fatG: 7.5 });
    expect(day.byMeal.lunch.totals).toEqual({ calories: 400, proteinG: 20, carbsG: 40, fatG: 10 });
    expect(day.byMeal.dinner.totals).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
    expect(day.byMeal.snack.totals).toEqual({ calories: 100, proteinG: 5, carbsG: 10, fatG: 2.5 });
    expect(day.totals).toEqual({ calories: 800, proteinG: 40, carbsG: 80, fatG: 20 });
  });

  it('shows a log once when the server row and a pending edit share an id, and the edit changes the total once', () => {
    const day = build([synced('s1', { quantity: 1 })], [pending('s1', { quantity: 3 })]);

    expect(day.entries).toHaveLength(1);
    expect(day.entries[0]).toMatchObject({ id: 's1', quantity: 3, pending: true });
    expect(day.totals.calories).toBe(600);
  });

  it('hides a log with a pending delete tombstone', () => {
    const day = build([synced('s1'), synced('s2')], [pending('s1', { deleted: true })]);

    expect(day.entries.map((e) => e.id)).toEqual(['s2']);
    expect(day.totals.calories).toBe(200);
  });

  it('keeps a tombstone for a log that never reached the server harmlessly absent', () => {
    expect(build([], [pending('gone', { deleted: true })]).entries).toEqual([]);
  });

  it('only includes entries for the requested local date', () => {
    const day = build([synced('s1', { date: '2026-10-12' }), synced('s2')], [pending('p1', { date: '2026-10-14' }), pending('p2')]);

    expect(day.entries.map((e) => e.id)).toEqual(['s2', 'p2']);
  });

  it('orders entries by meal then by arrival', () => {
    const day = build(
      [synced('s1', { mealType: 'dinner' }), synced('s2', { mealType: 'breakfast' })],
      [pending('p1', { mealType: 'breakfast' })]
    );

    expect(day.entries.map((e) => e.id)).toEqual(['s2', 'p1', 's1']);
  });

  it('resolves a pending log without a food snapshot from known foods', () => {
    const day = build([], [pending('p1', { food: null, foodId: 'k' })], [food('k', { calories: 90 })]);

    expect(day.entries[0].food?.id).toBe('k');
    expect(day.totals.calories).toBe(90);
    expect(day.incomplete).toBe(false);
  });

  it('flags a log whose food is unknown instead of counting it as zero', () => {
    const day = build([], [pending('p1', { food: null, foodId: 'missing' })], []);

    expect(day.entries[0]).toMatchObject({ id: 'p1', food: null, nutrition: null });
    expect(day.totals.calories).toBe(0);
    expect(day.incomplete).toBe(true);
  });

  it('keeps the source and verified label of each food', () => {
    const day = build([synced('s1', { food: food('a', { source: 'curated', verified: true, region: 'MY' }) })], []);

    expect(day.entries[0].food).toMatchObject({ source: 'curated', verified: true });
  });
});
