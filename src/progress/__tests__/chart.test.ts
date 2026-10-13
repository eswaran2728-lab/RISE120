import { chartPoints } from '../chart';

const size = { width: 300, height: 100, padding: 10 };

describe('chartPoints', () => {
  it('returns nothing for no points', () => {
    expect(chartPoints([], size)).toEqual([]);
  });

  it('centres a single point', () => {
    expect(chartPoints([{ date: '2026-10-13', weightKg: 70 }], size)).toEqual([{ x: 150, y: 50 }]);
  });

  it('spaces points by date, not by index (sparse weights)', () => {
    const points = chartPoints(
      [
        { date: '2026-10-13', weightKg: 70 },
        { date: '2026-10-14', weightKg: 69 },
        { date: '2026-10-23', weightKg: 68 },
      ],
      size
    );

    expect(points[0].x).toBe(10);
    expect(points[2].x).toBe(290);
    expect(points[1].x).toBeCloseTo(10 + (280 * 1) / 10, 5);
  });

  it('draws lower weights lower on screen', () => {
    const [first, second] = chartPoints(
      [
        { date: '2026-10-13', weightKg: 70 },
        { date: '2026-10-14', weightKg: 68 },
      ],
      size
    );

    expect(first.y).toBe(10);
    expect(second.y).toBe(90);
  });

  it('draws a flat line in the middle when the weight does not change', () => {
    const points = chartPoints(
      [
        { date: '2026-10-13', weightKg: 70 },
        { date: '2026-10-14', weightKg: 70 },
      ],
      size
    );

    expect(points.map((p) => p.y)).toEqual([50, 50]);
  });

  it('handles points on the same date by stacking at the same x', () => {
    const points = chartPoints(
      [
        { date: '2026-10-13', weightKg: 70 },
        { date: '2026-10-13', weightKg: 69 },
      ],
      size
    );

    expect(points[0].x).toBe(points[1].x);
  });
});
