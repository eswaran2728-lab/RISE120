import { buildFoodDay, SyncedLogEntry } from '../day';
import { defaultMealFor, foodDaySummary, foodSourceLabel, formatServing } from '../summary';
import type { Food } from '../types';

const food = (id: string, extra: Partial<Food> = {}): Food => ({
  id, userId: null, name: `Food ${id}`, aliases: {}, servingDesc: '1 plate (250 g)', calories: 500, proteinG: 20, carbsG: 60, fatG: 18,
  source: 'curated', verified: true, region: 'MY', sourceId: null, barcode: null, ...extra,
});

const row = (id: string, extra: Partial<SyncedLogEntry> = {}): SyncedLogEntry => ({
  id, date: '2026-10-13', foodId: 'a', quantity: 1, mealType: 'lunch', food: food('a'), ...extra,
});

const day = (rows: SyncedLogEntry[]) => buildFoodDay({ date: '2026-10-13', synced: rows, pending: [], knownFoods: [] });

describe('foodDaySummary', () => {
  it('shows consumed totals and remaining calories and protein against the plan targets', () => {
    const summary = foodDaySummary(day([row('1'), row('2', { mealType: 'dinner', quantity: 0.5 })]), { calories: 2000, proteinG: 100 });

    expect(summary.consumed).toEqual({ calories: 750, proteinG: 30, carbsG: 90, fatG: 27 });
    expect(summary.remaining).toEqual({ calories: 1250, proteinG: 70 });
  });

  it('keeps remaining missing when a target is missing, instead of inventing one', () => {
    const summary = foodDaySummary(day([row('1')]), { calories: null, proteinG: 100 });

    expect(summary.remaining).toEqual({ calories: null, proteinG: 80 });
  });

  it('reports how far over a target the user is, with remaining negative', () => {
    const summary = foodDaySummary(day([row('1', { quantity: 5 })]), { calories: 2000, proteinG: 80 });

    expect(summary.remaining).toEqual({ calories: -500, proteinG: -20 });
    expect(summary.overCalories).toBe(true);
    expect(summary.overProtein).toBe(true);
  });

  it('is not over a target when exactly on it or without a target', () => {
    const summary = foodDaySummary(day([row('1', { quantity: 2 })]), { calories: 1000, proteinG: null });

    expect(summary.overCalories).toBe(false);
    expect(summary.overProtein).toBe(false);
  });

  it('carries the incomplete flag so the screen can warn that totals may be low', () => {
    expect(foodDaySummary(day([row('1', { food: null, foodId: 'gone' })]), { calories: 2000, proteinG: 100 }).incomplete).toBe(true);
    expect(foodDaySummary(day([row('1')]), { calories: 2000, proteinG: 100 }).incomplete).toBe(false);
  });

  it('is all zeros with full targets remaining for an empty day', () => {
    const summary = foodDaySummary(day([]), { calories: 2000, proteinG: 100 });

    expect(summary.consumed).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
    expect(summary.remaining).toEqual({ calories: 2000, proteinG: 100 });
  });
});

describe('foodSourceLabel', () => {
  it('labels a reviewed Malaysian food as curated and verified', () => {
    expect(foodSourceLabel(food('a'))).toEqual({ key: 'food.sources.curated', verified: true });
  });

  it.each([
    ['usda', 'food.sources.usda'],
    ['openfoodfacts', 'food.sources.openfoodfacts'],
    ['custom', 'food.sources.custom'],
  ])('labels %s as unverified', (source, key) => {
    expect(foodSourceLabel(food('a', { source, verified: false }))).toEqual({ key, verified: false });
  });

  it('shows an unknown source as unknown rather than guessing', () => {
    expect(foodSourceLabel(food('a', { source: 'mystery', verified: false }))).toEqual({ key: 'food.sources.unknown', verified: false });
  });

  it('never presents an unverified food as verified', () => {
    expect(foodSourceLabel(food('a', { source: 'curated', verified: false })).verified).toBe(false);
  });
});

describe('formatServing', () => {
  it('shows the number of listed servings with the serving size', () => {
    expect(formatServing(1, '1 plate (250 g)')).toBe('1 × 1 plate (250 g)');
    expect(formatServing(1.5, '100 g')).toBe('1.5 × 100 g');
    expect(formatServing(0.25, '1 cup')).toBe('0.25 × 1 cup');
  });
});

describe('defaultMealFor', () => {
  it.each([
    [5, 'breakfast'],
    [10, 'breakfast'],
    [11, 'lunch'],
    [15, 'lunch'],
    [16, 'snack'],
    [17, 'snack'],
    [18, 'dinner'],
    [21, 'dinner'],
    [22, 'snack'],
    [2, 'snack'],
  ])('suggests the meal for hour %i', (hour, meal) => {
    expect(defaultMealFor(new Date(2026, 9, 13, hour, 30))).toBe(meal);
  });
});
