import { cmFromFtIn, ftInFromCm, kgFromLb, lbFromKg, parseDecimal } from '../units';

describe('parseDecimal', () => {
  it.each([
    ['70.5', 70.5],
    ['70,5', 70.5],
    [' 70 ', 70],
  ])('parses %j as %d', (input, expected) => {
    expect(parseDecimal(input)).toBe(expected);
  });

  it.each(['abc', '', '   ', '7,0,5', '7.0.5', '7,0.5'])('returns null for %j', (input) => {
    expect(parseDecimal(input)).toBeNull();
  });
});

describe('unit conversion', () => {
  it('converts pounds to kilograms', () => {
    expect(Math.abs(kgFromLb(154.3) - 70.0)).toBeLessThanOrEqual(0.05);
  });

  it('converts feet and inches to centimeters', () => {
    expect(Math.abs(cmFromFtIn(5, 10) - 177.8)).toBeLessThanOrEqual(0.1);
  });
});

describe('reverse unit conversion', () => {
  it('converts kilograms to pounds', () => {
    expect(Math.abs(lbFromKg(70) - 154.3)).toBeLessThanOrEqual(0.05);
  });

  it('converts centimeters to feet and inches', () => {
    const { ft, inches } = ftInFromCm(177.8);
    expect(ft).toBe(5);
    expect(Math.abs(inches - 10)).toBeLessThanOrEqual(0.1);
  });

  it('never returns 12 inches', () => {
    expect(ftInFromCm(182.85)).toEqual({ ft: 6, inches: 0 });
  });
});
