import { addLocalDays, dayNumberFor } from '../lib/dates';
import type { LocalDate } from '../sync/types';
import type { Plan, PlanDay } from '../plan/types';

export const PLAN_LENGTH = 120;

export function getPlanDay(plan: Plan, days: PlanDay[], localDate: LocalDate): PlanDay | null {
  const dayNumber = dayNumberFor(plan.startDate, localDate);
  if (dayNumber < 1 || dayNumber > PLAN_LENGTH) return null;
  return days.find((day) => day.dayNumber === dayNumber) ?? null;
}

export type PlanPhase = 'not_started' | 'active' | 'complete';

// Day 121 onward is a finished plan, not a missing one.
export function planPhase(plan: Plan, localDate: LocalDate): PlanPhase {
  const dayNumber = dayNumberFor(plan.startDate, localDate);
  if (dayNumber < 1) return 'not_started';
  return dayNumber > PLAN_LENGTH ? 'complete' : 'active';
}

export interface TodayState {
  dayNumber: number;
  kind: 'rest' | 'workout';
  plannedSets: number;
  completedSets: number;
  checkinDone: boolean;
  // 0..1. With a workout scheduled, the workout and the check-in are half each (workout
  // progress is the share of planned sets done); on a rest day the check-in is all of it.
  ringProgress: number;
  calorieTarget: number | null;
  proteinTargetG: number | null;
}

export function deriveToday(day: PlanDay, loggedSets: { exerciseId: string }[], checkinDone: boolean): TodayState {
  const base = {
    dayNumber: day.dayNumber,
    checkinDone,
    calorieTarget: day.calorieTarget,
    proteinTargetG: day.proteinTargetG,
  };
  if (day.workout.kind === 'rest') {
    return { ...base, kind: 'rest', plannedSets: 0, completedSets: 0, ringProgress: checkinDone ? 1 : 0 };
  }

  // Extra sets beyond the plan, or sets of other exercises, do not count.
  let plannedSets = 0;
  let completedSets = 0;
  for (const entry of day.workout.exercises) {
    const logged = loggedSets.filter((set) => set.exerciseId === entry.exercise_id).length;
    plannedSets += entry.sets;
    completedSets += Math.min(logged, entry.sets);
  }
  const workoutShare = plannedSets === 0 ? 0 : completedSets / plannedSets;
  const ringProgress = 0.5 * workoutShare + (checkinDone ? 0.5 : 0);
  return { ...base, kind: 'workout', plannedSets, completedSets, ringProgress };
}

// Consecutive local calendar days with a check-in. Today not being checked in yet does not
// break the streak: it counts back from yesterday until the day is over.
export function checkinStreak(checkinDates: LocalDate[], localDate: LocalDate): number {
  const dates = new Set(checkinDates);
  let cursor = dates.has(localDate) ? localDate : addLocalDays(localDate, -1);
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = addLocalDays(cursor, -1);
  }
  return streak;
}
