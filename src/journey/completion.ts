// Where a 120-day cycle stands, and what to show at its end. Day 120 is the last day; the review and the choice of
// what comes next begin on day 121. The summary counts what the member did and says nothing about how well:
// no score, rate or verdict.
import { addLocalDays, dayNumberFor } from '../lib/dates';
import type { LocalDate } from '../sync/types';

export const CYCLE_LENGTH = 120;

export type CycleStage = 'not_started' | 'running' | 'last_day' | 'ready_for_review';

export function cycleStage(startDate: LocalDate, today: LocalDate): CycleStage {
  const day = dayNumberFor(startDate, today);
  if (day < 1) return 'not_started';
  if (day < CYCLE_LENGTH) return 'running';
  if (day === CYCLE_LENGTH) return 'last_day';
  return 'ready_for_review';
}

// The next cycle starts today, once day 120 is behind the member. Before that there is nothing to start.
export function nextCycleStartDate(startDate: LocalDate, today: LocalDate): LocalDate | null {
  return cycleStage(startDate, today) === 'ready_for_review' ? today : null;
}

export interface ParticipationSummary {
  checkinDays: number; // days with a check-in
  workoutDays: number; // days with at least one logged set
  totalDays: number; // always 120
  daysElapsed: number; // days of this cycle that have passed, up to 120
}

export function participationSummary(input: { startDate: LocalDate; today: LocalDate; checkinDates: LocalDate[]; workoutDates: LocalDate[] }): ParticipationSummary {
  const inCycle = (date: LocalDate) => {
    const day = dayNumberFor(input.startDate, date);
    return day >= 1 && day <= CYCLE_LENGTH;
  };
  const distinct = (dates: LocalDate[]) => new Set(dates.filter(inCycle)).size;
  return {
    checkinDays: distinct(input.checkinDates),
    workoutDays: distinct(input.workoutDates),
    totalDays: CYCLE_LENGTH,
    daysElapsed: Math.min(CYCLE_LENGTH, Math.max(0, dayNumberFor(input.startDate, input.today))),
  };
}

export const lastDayOf = (startDate: LocalDate): LocalDate => addLocalDays(startDate, CYCLE_LENGTH - 1);
