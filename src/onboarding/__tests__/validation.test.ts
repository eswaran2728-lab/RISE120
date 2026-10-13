import { kgFromLb } from '../units';
import { validateBody } from '../validation';

const valid = { age: 30, heightCm: 170, weightKg: 70 };

describe('validateBody', () => {
  it.each([
    [{ ...valid, age: 17 }, 'age', 'min'],
    [{ ...valid, age: 81 }, 'age', 'max'],
    [{ ...valid, heightCm: 119 }, 'heightCm', 'min'],
    [{ ...valid, heightCm: 231 }, 'heightCm', 'max'],
    [{ ...valid, weightKg: 29 }, 'weightKg', 'min'],
    [{ ...valid, weightKg: 301 }, 'weightKg', 'max'],
  ])('rejects %j as %s %s', (body, field, reason) => {
    expect(validateBody(body)).toEqual({ ok: false, field, reason });
  });

  it('accepts the lower and upper bounds', () => {
    expect(validateBody({ age: 18, heightCm: 120, weightKg: 30 })).toEqual({ ok: true });
    expect(validateBody({ age: 80, heightCm: 230, weightKg: 300 })).toEqual({ ok: true });
  });

  it('reports the first failing field in order age, height, weight', () => {
    expect(validateBody({ age: 17, heightCm: 119, weightKg: 29 })).toMatchObject({ field: 'age' });
    expect(validateBody({ age: 30, heightCm: 119, weightKg: 29 })).toMatchObject({ field: 'heightCm' });
  });

  it('validates pounds after converting to kilograms', () => {
    // 330 lb is about 149.7 kg, inside 30-300 kg; 700 lb is about 317.5 kg, above it.
    expect(validateBody({ ...valid, weightKg: kgFromLb(330) })).toEqual({ ok: true });
    expect(validateBody({ ...valid, weightKg: kgFromLb(700) })).toEqual({
      ok: false,
      field: 'weightKg',
      reason: 'max',
    });
  });
});
