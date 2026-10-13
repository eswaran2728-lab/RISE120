import { cmFromFtIn, kgFromLb, parseDecimal } from '../units';

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
