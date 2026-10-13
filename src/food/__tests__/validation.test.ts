import { isEnergyConsistent, parseFoodInput, parseQuantity } from '../validation';

const valid = { name: 'Nasi lemak', servingDesc: '1 plate (250 g)', calories: '644', protein: '15,5', carbs: '80', fat: '28' };

describe('parseFoodInput', () => {
  it('parses decimal-comma values and trims text', () => {
    expect(parseFoodInput({ ...valid, name: '  Nasi lemak  ' })).toEqual({
      ok: true,
      value: { name: 'Nasi lemak', servingDesc: '1 plate (250 g)', calories: 644, proteinG: 15.5, carbsG: 80, fatG: 28 },
    });
  });

  it('accepts an explicit zero for a macro (water, black coffee)', () => {
    const result = parseFoodInput({ ...valid, calories: '0', protein: '0', carbs: '0', fat: '0' });

    expect(result.ok).toBe(true);
  });

  it.each([
    ['name', { name: '   ' }, 'required'],
    ['servingDesc', { servingDesc: '' }, 'required'],
    ['calories', { calories: '' }, 'required'],
    ['protein', { protein: '' }, 'required'],
    ['carbs', { carbs: '  ' }, 'required'],
    ['fat', { fat: '' }, 'required'],
    ['calories', { calories: 'abc' }, 'invalid'],
    ['protein', { protein: '1,2,3' }, 'invalid'],
    ['carbs', { carbs: '12 g' }, 'invalid'],
    ['fat', { fat: '-1' }, 'invalid'],
    ['calories', { calories: '10001' }, 'max'],
    ['protein', { protein: '1001' }, 'max'],
  ] as const)('rejects %s %j as %s', (field, override, reason) => {
    expect(parseFoodInput({ ...valid, ...override })).toEqual({ ok: false, field, reason });
  });

  it('reports the first failing field in form order', () => {
    expect(parseFoodInput({ ...valid, name: '', calories: 'abc' })).toMatchObject({ field: 'name' });
  });

  it('never turns a blank nutrient into zero', () => {
    const result = parseFoodInput({ ...valid, fat: '' });

    expect(result.ok).toBe(false);
  });
});

describe('parseQuantity', () => {
  it.each([
    ['1', 1],
    ['1,5', 1.5],
    ['0.5', 0.5],
    [' 2 ', 2],
    ['0.25', 0.25],
  ])('parses %j as %d servings', (input, expected) => {
    expect(parseQuantity(input)).toEqual({ ok: true, quantity: expected });
  });

  it.each([
    ['', 'required'],
    ['abc', 'invalid'],
    ['0', 'invalid'],
    ['-1', 'invalid'],
    ['1,2,3', 'invalid'],
    ['100.5', 'max'],
  ])('rejects %j as %s', (input, reason) => {
    expect(parseQuantity(input)).toEqual({ ok: false, reason });
  });
});

describe('isEnergyConsistent', () => {
  it('accepts values where energy matches protein, carbs and fat (Atwater 4/4/9)', () => {
    expect(isEnergyConsistent({ calories: 644, proteinG: 15.5, carbsG: 80, fatG: 28 })).toBe(true);
  });

  it('accepts a small tolerance for fibre, alcohol and rounding', () => {
    expect(isEnergyConsistent({ calories: 100, proteinG: 5, carbsG: 15, fatG: 2 })).toBe(true); // 98 from macros
  });

  it('rejects a record whose energy is far from its macros (mixed units or bad data)', () => {
    expect(isEnergyConsistent({ calories: 2500, proteinG: 5, carbsG: 15, fatG: 2 })).toBe(false);
    expect(isEnergyConsistent({ calories: 50, proteinG: 30, carbsG: 50, fatG: 20 })).toBe(false);
  });

  it('accepts a true zero-calorie food', () => {
    expect(isEnergyConsistent({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })).toBe(true);
  });

  it('rejects calories with no macros at all, and macros with no calories', () => {
    expect(isEnergyConsistent({ calories: 300, proteinG: 0, carbsG: 0, fatG: 0 })).toBe(false);
    expect(isEnergyConsistent({ calories: 0, proteinG: 20, carbsG: 30, fatG: 10 })).toBe(false);
  });
});
