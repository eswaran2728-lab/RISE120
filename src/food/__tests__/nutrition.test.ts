import { foodNutrition, remainingNutrition, sumNutrition } from '../nutrition';
import type { Food } from '../types';

const food: Food = {
  id: 'f1',
  userId: null,
  name: 'Nasi lemak',
  aliases: {},
  servingDesc: '1 plate (250 g)',
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

describe('foodNutrition', () => {
  it('multiplies by the number of listed servings', () => {
    expect(foodNutrition(food, 1)).toEqual({ calories: 644, proteinG: 15.5, carbsG: 80, fatG: 28 });
    expect(foodNutrition(food, 2)).toEqual({ calories: 1288, proteinG: 31, carbsG: 160, fatG: 56 });
  });

  it('supports fractional servings (1.5 and a half)', () => {
    expect(foodNutrition(food, 1.5)).toEqual({ calories: 966, proteinG: 23.25, carbsG: 120, fatG: 42 });
    expect(foodNutrition(food, 0.5)).toEqual({ calories: 322, proteinG: 7.75, carbsG: 40, fatG: 14 });
  });

  it('removes floating point noise', () => {
    const odd = { ...food, calories: 0.1, proteinG: 0.2, carbsG: 0.3, fatG: 0.7 };

    expect(foodNutrition(odd, 3)).toEqual({ calories: 0.3, proteinG: 0.6, carbsG: 0.9, fatG: 2.1 });
  });

  it('is zero for a zero quantity but never negative', () => {
    expect(foodNutrition(food, 0)).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
    expect(() => foodNutrition(food, -1)).toThrow();
  });
});

describe('sumNutrition', () => {
  it('adds entries once and rounds only the total', () => {
    const total = sumNutrition([
      { calories: 0.1, proteinG: 0.1, carbsG: 0.1, fatG: 0.1 },
      { calories: 0.2, proteinG: 0.2, carbsG: 0.2, fatG: 0.2 },
    ]);

    expect(total).toEqual({ calories: 0.3, proteinG: 0.3, carbsG: 0.3, fatG: 0.3 });
  });

  it('is zero for no entries', () => {
    expect(sumNutrition([])).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });
});

describe('remainingNutrition', () => {
  const consumed = { calories: 800, proteinG: 40, carbsG: 100, fatG: 30 };

  it('subtracts what was eaten from the targets', () => {
    expect(remainingNutrition({ calories: 2000, proteinG: 120 }, consumed)).toEqual({ calories: 1200, proteinG: 80 });
  });

  it('keeps a missing target missing instead of inventing one', () => {
    expect(remainingNutrition({ calories: null, proteinG: 120 }, consumed)).toEqual({ calories: null, proteinG: 80 });
    expect(remainingNutrition({ calories: 2000, proteinG: null }, consumed)).toEqual({ calories: 1200, proteinG: null });
    expect(remainingNutrition({ calories: null, proteinG: null }, consumed)).toEqual({ calories: null, proteinG: null });
  });

  it('goes negative when the target is exceeded so the screen can show the overage', () => {
    expect(remainingNutrition({ calories: 700, proteinG: 30 }, consumed)).toEqual({ calories: -100, proteinG: -10 });
  });
});
