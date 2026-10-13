import { getPlanDay } from '../selectors';
import type { Plan, PlanDay } from '../../plan/types';

const plan: Plan = { id: 'p1', startDate: '2026-10-13', status: 'active' };
const days: PlanDay[] = Array.from({ length: 120 }, (_, i) => ({
  dayNumber: i + 1,
  workout: { kind: 'rest' },
  calorieTarget: null,
  proteinTargetG: 100,
}));

describe('getPlanDay', () => {
  it('returns day 1 on the start date', () => {
    expect(getPlanDay(plan, days, '2026-10-13')?.dayNumber).toBe(1);
  });

  it('returns day 120 on the last day and null after it', () => {
    expect(getPlanDay(plan, days, '2027-02-09')?.dayNumber).toBe(120);
    expect(getPlanDay(plan, days, '2027-02-10')).toBeNull();
  });

  it('returns null before the plan starts', () => {
    expect(getPlanDay(plan, days, '2026-10-12')).toBeNull();
  });

  it('does not shift the day at the local midnight boundary', () => {
    expect(getPlanDay(plan, days, '2026-10-13')?.dayNumber).toBe(1);
    expect(getPlanDay(plan, days, '2026-10-14')?.dayNumber).toBe(2);
  });

  it('returns null when that day is missing from the loaded days', () => {
    expect(getPlanDay(plan, days.filter((d) => d.dayNumber !== 5), '2026-10-17')).toBeNull();
  });
});
