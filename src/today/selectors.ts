import { dayNumberFor } from '../lib/dates';
import type { LocalDate } from '../sync/types';
import type { Plan, PlanDay } from '../plan/types';

export const PLAN_LENGTH = 120;

export function getPlanDay(plan: Plan, days: PlanDay[], localDate: LocalDate): PlanDay | null {
  const dayNumber = dayNumberFor(plan.startDate, localDate);
  if (dayNumber < 1 || dayNumber > PLAN_LENGTH) return null;
  return days.find((day) => day.dayNumber === dayNumber) ?? null;
}
