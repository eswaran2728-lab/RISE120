import { per100gToServing, scaleAmount, scaleServingsFactor, servingNutrition, toGrams, type Per100g, type PerServing } from '../portions';

const perServing = (over: Partial<PerServing> = {}): PerServing => ({ basis: 'per_serving', calories: 400, proteinG: 20, carbsG: 50, fatG: 10, fibreG: null, sugarG: null, sodiumMg: null, ...over });
const per100g = (over: Partial<Per100g> = {}): Per100g => ({ basis: 'per_100g', calories: 200, proteinG: 10, carbsG: 25, fatG: 5, fibreG: 2, sugarG: null, sodiumMg: null, ...over });

describe('scaleServingsFactor (how much of a recipe, as a fraction of its yield)', () => {
  it('is the wanted servings over the recipe yield, including fractional portions', () => {
    expect(scaleServingsFactor(4, 2)).toBe(0.5);
    expect(scaleServingsFactor(4, 6)).toBe(1.5);
    expect(scaleServingsFactor(2, 0.5)).toBe(0.25);
    expect(scaleServingsFactor(3, 1)).toBeCloseTo(1 / 3, 10);
  });

  it.each([0, -1, NaN, Infinity, 51])('refuses %s servings', (wanted) => {
    expect(() => scaleServingsFactor(4, wanted)).toThrow(/servings/i);
  });

  it('refuses a recipe whose yield is not a positive number', () => {
    expect(() => scaleServingsFactor(0, 1)).toThrow(/yield/i);
    expect(() => scaleServingsFactor(NaN, 1)).toThrow(/yield/i);
  });
});

describe('scaleAmount', () => {
  it('scales an ingredient amount and rounds to two decimals without float noise', () => {
    expect(scaleAmount(200, 1.5)).toBe(300);
    expect(scaleAmount(1, 1 / 3)).toBe(0.33);
    expect(scaleAmount(0.1, 3)).toBe(0.3);
  });
});

describe('servingNutrition (per-serving values times servings)', () => {
  it('multiplies known values and leaves unknown ones unknown, never zero', () => {
    const result = servingNutrition(perServing({ fibreG: 4, sugarG: null }), 2.5);

    expect(result).toMatchObject({ calories: 1000, proteinG: 50, carbsG: 125, fatG: 25, fibreG: 10 });
    expect(result.sugarG).toBeNull();
    expect(result.sodiumMg).toBeNull();
  });

  it('keeps a missing calorie value missing', () => {
    const result = servingNutrition(perServing({ calories: null }), 2);

    expect(result.calories).toBeNull();
    expect(result.proteinG).toBe(40);
  });

  it('refuses values that are not per serving, so per-100 g numbers are never multiplied as servings', () => {
    expect(() => servingNutrition(per100g() as never, 2)).toThrow(/per serving/i);
  });

  it('rounds to two decimals', () => {
    expect(servingNutrition(perServing({ calories: 333.333 }), 3).calories).toBe(1000);
    expect(servingNutrition(perServing({ proteinG: 1.005 }), 1).proteinG).toBe(1.01);
  });
});

describe('per100gToServing (grams are not servings)', () => {
  it('converts per-100 g values to a serving of known weight', () => {
    const result = per100gToServing(per100g(), 250);

    expect(result).toMatchObject({ basis: 'per_serving', calories: 500, proteinG: 25, carbsG: 62.5, fatG: 12.5, fibreG: 5 });
    expect(result.sugarG).toBeNull();
  });

  it('gives every value as unknown when the serving weight is unknown, rather than guessing', () => {
    const result = per100gToServing(per100g(), null);

    expect([result.calories, result.proteinG, result.carbsG, result.fatG]).toEqual([null, null, null, null]);
  });

  it.each([0, -5, NaN])('refuses a serving weight of %s g', (grams) => {
    expect(() => per100gToServing(per100g(), grams)).toThrow(/grams/i);
  });

  it('refuses values that are already per serving', () => {
    expect(() => per100gToServing(perServing() as never, 100)).toThrow(/per 100/i);
  });
});

describe('toGrams', () => {
  it('converts mass units directly', () => {
    expect(toGrams({ amount: 250, unit: 'g' })).toBe(250);
    expect(toGrams({ amount: 1.5, unit: 'kg' })).toBe(1500);
  });

  it('is unknown for volumes and pieces unless a weight is supplied, never an assumed one', () => {
    expect(toGrams({ amount: 2, unit: 'piece' })).toBeNull();
    expect(toGrams({ amount: 250, unit: 'ml' })).toBeNull();
    expect(toGrams({ amount: 2, unit: 'piece' }, 60)).toBe(120);
    expect(toGrams({ amount: 250, unit: 'ml' }, 1.03)).toBe(257.5);
  });

  it('refuses a negative or non-numeric amount or weight', () => {
    expect(() => toGrams({ amount: -1, unit: 'g' })).toThrow();
    expect(() => toGrams({ amount: NaN, unit: 'g' })).toThrow();
    expect(() => toGrams({ amount: 2, unit: 'piece' }, 0)).toThrow();
  });
});
