import { addLocalDays, dayNumberFor } from '../lib/dates';
import type { LocalDate } from '../sync/types';
import type { Plan, PlanDay } from '../plan/types';
import type { GuidedProgress } from '../workout/guidedProgress';

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
  // The sets shown: those of whichever path (regular plan or guided session) is further along.
  plannedSets: number;
  completedSets: number;
  // The day's workout is done. One definition, shared by Today and the reminders: every planned set of the regular
  // workout is logged, or the guided session was finished by the member or has every planned set logged.
  workoutComplete: boolean;
  checkinDone: boolean;
  // 0..1. With a workout scheduled, the workout and the check-in are half each (workout
  // progress is the share of the further-along path, never the sum of both); on a rest day the check-in is all of it.
  ringProgress: number;
  calorieTarget: number | null;
  proteinTargetG: number | null;
}

export type LoggedSetRef = { exerciseId: string; sessionId?: string | null };

// Sets of the guided session that count towards its planned sets. Extra sets of one exercise never stand in for a
// missing set of another.
function guidedDone(guided: GuidedProgress, sets: LoggedSetRef[]): { planned: number; done: number } {
  let planned = 0;
  let done = 0;
  for (const entry of guided.planned) {
    const logged = sets.filter((set) => set.sessionId === guided.sessionId && set.exerciseId === entry.exerciseId).length;
    planned += entry.sets;
    done += Math.min(logged, entry.sets);
  }
  return { planned, done };
}

export function deriveToday(day: PlanDay, loggedSets: LoggedSetRef[], checkinDone: boolean, guided: GuidedProgress | null = null): TodayState {
  const base = {
    dayNumber: day.dayNumber,
    checkinDone,
    calorieTarget: day.calorieTarget,
    proteinTargetG: day.proteinTargetG,
  };
  if (day.workout.kind === 'rest') {
    return { ...base, kind: 'rest', plannedSets: 0, completedSets: 0, workoutComplete: false, ringProgress: checkinDone ? 1 : 0 };
  }

  // The regular workout counts only sets logged outside a guided session, so a guided set of an exercise that is
  // also in the plan is never counted twice. Extra sets, and sets of other exercises, do not count.
  const regularSets = loggedSets.filter((set) => !set.sessionId);
  let plannedSets = 0;
  let completedSets = 0;
  for (const entry of day.workout.exercises) {
    const logged = regularSets.filter((set) => set.exerciseId === entry.exercise_id).length;
    plannedSets += entry.sets;
    completedSets += Math.min(logged, entry.sets);
  }
  const regularShare = plannedSets === 0 ? 0 : completedSets / plannedSets;
  const regularComplete = plannedSets > 0 && completedSets >= plannedSets;

  let shown = { planned: plannedSets, done: completedSets };
  let share = regularShare;
  let guidedComplete = false;
  if (guided) {
    const g = guidedDone(guided, loggedSets);
    const guidedShare = g.planned === 0 ? 0 : g.done / g.planned;
    guidedComplete = guided.status === 'completed' || (g.planned > 0 && g.done >= g.planned);
    if (guidedShare > regularShare) {
      shown = { planned: g.planned, done: g.done };
      share = guidedShare;
    }
  }

  const workoutComplete = regularComplete || guidedComplete;
  const workoutShare = workoutComplete ? 1 : share;
  return {
    ...base,
    kind: 'workout',
    plannedSets: shown.planned,
    completedSets: shown.done,
    workoutComplete,
    ringProgress: 0.5 * workoutShare + (checkinDone ? 0.5 : 0),
  };
}

// Whether the day's workout is done, by the same rules as deriveToday.
export function isWorkoutComplete(day: PlanDay, loggedSets: LoggedSetRef[], guided: GuidedProgress | null = null): boolean {
  return deriveToday(day, loggedSets, false, guided).workoutComplete;
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
