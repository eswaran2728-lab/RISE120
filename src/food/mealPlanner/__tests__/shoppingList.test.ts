import { mergeShoppingList } from '../shoppingList';
import { recipe, ing } from '../testing/fixtures';

const line = (list: ReturnType<typeof mergeShoppingList>, name: string, unit: string) => list.find((i) => i.name === name && i.unit === unit);

describe('mergeShoppingList', () => {
  it('adds the same ingredient across meals, scaled to the servings planned', () => {
    const a = recipe('a', { servings: 2, ingredients: [ing('rice', 200)] });
    const b = recipe('b', { servings: 4, ingredients: [ing('rice', 400)] });

    const list = mergeShoppingList([{ recipe: a, servings: 1 }, { recipe: b, servings: 2 }]);

    expect(list).toEqual([expect.objectContaining({ name: 'rice', amount: 300, unit: 'g', forRecipes: ['a', 'b'] })]); // 100 g (half of a) + 200 g (half of b)
  });

  it('combines compatible units: grams with kilograms, millilitres with litres', () => {
    const a = recipe('a', { servings: 1, ingredients: [ing('rice', 200, 'g'), ing('milk', 250, 'ml')] });
    const b = recipe('b', { servings: 1, ingredients: [ing('rice', 0.3, 'kg'), ing('milk', 0.5, 'l')] });

    const list = mergeShoppingList([{ recipe: a, servings: 1 }, { recipe: b, servings: 1 }]);

    expect(line(list, 'rice', 'g')!.amount).toBe(500);
    expect(line(list, 'milk', 'ml')!.amount).toBe(750);
    expect(list.filter((i) => i.name === 'rice')).toHaveLength(1);
  });

  it('keeps incompatible units as separate lines instead of guessing a conversion', () => {
    const a = recipe('a', { servings: 1, ingredients: [ing('egg', 2, 'piece'), ing('oil', 1, 'tbsp')] });
    const b = recipe('b', { servings: 1, ingredients: [ing('egg', 100, 'g'), ing('oil', 2, 'tsp'), ing('oil', 2, 'tbsp')] });

    const list = mergeShoppingList([{ recipe: a, servings: 1 }, { recipe: b, servings: 1 }]);

    expect(line(list, 'egg', 'piece')!.amount).toBe(2);
    expect(line(list, 'egg', 'g')!.amount).toBe(100);
    expect(line(list, 'oil', 'tbsp')!.amount).toBe(3); // the same unit adds up
    expect(line(list, 'oil', 'tsp')!.amount).toBe(2); // a different spoon stays separate
  });

  it('scales fractional servings and rounds to two decimals', () => {
    const a = recipe('a', { servings: 3, ingredients: [ing('rice', 100)] });

    const list = mergeShoppingList([{ recipe: a, servings: 0.5 }]);

    expect(list[0].amount).toBe(16.67);
  });

  it('identifies an ingredient by its reference, not its display name', () => {
    const a = recipe('a', { servings: 1, ingredients: [{ ...ing('rice', 100), name: 'Rice' }] });
    const b = recipe('b', { servings: 1, ingredients: [{ ...ing('rice', 100), name: 'Nasi' }] });
    const c = recipe('c', { servings: 1, ingredients: [{ ref: { source: 'other', sourceId: 'rice' }, name: 'Rice', amount: 100, unit: 'g', tags: [] }] });

    const list = mergeShoppingList([{ recipe: a, servings: 1 }, { recipe: b, servings: 1 }, { recipe: c, servings: 1 }]);

    expect(list).toHaveLength(2);
    expect(list.find((i) => i.ref.source === 'fixture')!.amount).toBe(200);
  });

  it('lists in a stable order and gives nothing for no meals', () => {
    const a = recipe('a', { servings: 1, ingredients: [ing('zucchini', 1), ing('apple', 1)] });

    expect(mergeShoppingList([{ recipe: a, servings: 1 }]).map((i) => i.name)).toEqual(['apple', 'zucchini']);
    expect(mergeShoppingList([])).toEqual([]);
  });

  it('refuses servings that are not a positive number', () => {
    expect(() => mergeShoppingList([{ recipe: recipe('a'), servings: 0 }])).toThrow();
  });
});
