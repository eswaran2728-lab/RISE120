import { scaleRecipe, type Recipe } from '../recipes';

const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const base = (over: Partial<Recipe> = {}): Recipe => ({
  id: 'fixture', version: 1, userId: null, status: 'draft', verified: false, region: 'MY', name: L('Fixture'), aliases: {}, servings: 4,
  ingredients: [
    { ref: { source: 'fixture', sourceId: 'rice' }, name: 'rice', amount: 400, unit: 'g', tags: [] },
    { ref: { source: 'fixture', sourceId: 'egg' }, name: 'egg', amount: 4, unit: 'piece', tags: ['egg'] },
  ],
  preparation: [L('Cook.')], prepMinutes: 5, cookMinutes: 10, cooking: ['stovetop'], dietLabels: [], freeFrom: [],
  nutrition: { perServing: { basis: 'per_serving', calories: 300, proteinG: 15, carbsG: 40, fatG: 8, fibreG: null, sugarG: null, sodiumMg: null }, provenance: { name: 'Fixture', url: null, recordId: null, version: '1', accessedOn: '2000-01-01', licenceEvidence: 'Fixture' } },
  price: { amount: 10, currency: 'MYR', pricedOn: '2000-01-02', servings: 4, source: 'Fixture' },
  reviewer: null,
  ...over,
});

describe('scaleRecipe', () => {
  it('scales ingredient amounts by servings over yield, including fractional portions, keeping units', () => {
    const scaled = scaleRecipe(base(), 1.5);

    expect(scaled.ingredients.map((i) => [i.name, i.amount, i.unit])).toEqual([['rice', 150, 'g'], ['egg', 1.5, 'piece']]);
  });

  it('gives per-serving nutrition times the servings wanted, not times the yield factor', () => {
    const scaled = scaleRecipe(base(), 1.5);

    expect(scaled.nutrition).toMatchObject({ basis: 'per_serving', calories: 450, proteinG: 22.5 });
    expect(scaled.nutrition!.fibreG).toBeNull();
  });

  it('prices the servings wanted from the price of the servings it was quoted for, and keeps the currency', () => {
    expect(scaleRecipe(base(), 2).price).toEqual({ amount: 5, currency: 'MYR' });
    expect(scaleRecipe(base({ price: { amount: 10, currency: 'MYR', pricedOn: '2000-01-02', servings: 2, source: 'x' } }), 1).price).toEqual({ amount: 5, currency: 'MYR' });
  });

  it('leaves price and nutrition unknown when the recipe has none, never zero', () => {
    const scaled = scaleRecipe(base({ price: null, nutrition: null }), 2);

    expect(scaled.price).toBeNull();
    expect(scaled.nutrition).toBeNull();
  });

  it('refuses servings that are not a sensible positive number', () => {
    expect(() => scaleRecipe(base(), 0)).toThrow();
    expect(() => scaleRecipe(base(), -2)).toThrow();
    expect(() => scaleRecipe(base({ servings: 0 }), 1)).toThrow(/yield/i);
  });

  it('does not change the recipe it scales', () => {
    const recipe = base();
    const before = JSON.stringify(recipe);

    scaleRecipe(recipe, 3);

    expect(JSON.stringify(recipe)).toBe(before);
  });
});
