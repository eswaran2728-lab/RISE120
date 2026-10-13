import { dayNumberFor } from '../lib/dates';
import type { LocalDate } from '../sync/types';

export interface ChartSize {
  width: number;
  height: number;
  padding: number;
}

// Maps weights over time to screen points. x follows the calendar date (so a gap between
// check-ins is a gap on the chart); lower weights are drawn lower on the screen.
export function chartPoints(points: { date: LocalDate; weightKg: number }[], size: ChartSize): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const dates = points.map((p) => p.date).sort();
  const first = dates[0];
  const range = dayNumberFor(first, dates[dates.length - 1]) - 1;
  const weights = points.map((p) => p.weightKg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const innerWidth = size.width - 2 * size.padding;
  const innerHeight = size.height - 2 * size.padding;

  return points.map((point) => {
    const x = range === 0 ? size.width / 2 : size.padding + ((dayNumberFor(first, point.date) - 1) / range) * innerWidth;
    const y = max === min ? size.height / 2 : size.padding + ((max - point.weightKg) / (max - min)) * innerHeight;
    return { x, y };
  });
}
