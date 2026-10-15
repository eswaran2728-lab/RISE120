import { supabase } from '../lib/supabase';
import { readCache, writeCache } from '../cache/userCache';
import type { LoggedSet } from '../workout/log';
import type { Exercise, Plan, PlanDay, PlanWorkout } from './types';

type Row = Record<string, any>;

export const mapPlan = (row: Row): Plan => ({ id: row.id, startDate: row.start_date, status: row.status });

function mapWorkout(value: unknown): PlanWorkout {
  const workout = value as { kind?: string; exercises?: unknown } | null;
  if (workout?.kind === 'workout' && Array.isArray(workout.exercises)) return workout as PlanWorkout;
  return { kind: 'rest' };
}

export const mapPlanDay = (row: Row): PlanDay => ({
  dayNumber: row.day_number,
  workout: mapWorkout(row.workout),
  calorieTarget: row.calorie_target ?? null,
  proteinTargetG: row.protein_target_g ?? null,
});

export const mapExercise = (row: Row): Exercise => ({
  id: row.id,
  name: row.name,
  muscleGroup: row.muscle_group,
  equipment: row.equipment,
  instructions: row.instructions,
});

export const mapLoggedSet = (row: Row): LoggedSet => ({
  id: row.id,
  exerciseId: row.exercise_id,
  setNumber: row.set_number,
  reps: row.reps,
  weightKg: Number(row.weight_kg),
});

export interface PlanBundle {
  plan: Plan;
  days: PlanDay[];
  exercises: Exercise[];
}

async function fetchPlanBundle(userId: string): Promise<PlanBundle | null> {
  const { data: planRow, error: planError } = await supabase
    .from('plans')
    .select('id, start_date, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (planError) throw new Error(planError.message);
  if (!planRow) return null;

  const [daysResult, exercisesResult] = await Promise.all([
    supabase
      .from('plan_days')
      .select('day_number, workout, calorie_target, protein_target_g')
      .eq('plan_id', planRow.id)
      .order('day_number'),
    supabase.from('exercises').select('id, name, muscle_group, equipment, instructions'),
  ]);
  if (daysResult.error) throw new Error(daysResult.error.message);
  if (exercisesResult.error) throw new Error(exercisesResult.error.message);

  return {
    plan: mapPlan(planRow),
    days: (daysResult.data ?? []).map(mapPlanDay),
    exercises: (exercisesResult.data ?? []).map(mapExercise),
  };
}

// Reads run under row-level security, so a user only ever receives their own plan. The last good
// bundle is cached per user: with no signal the app keeps working from it. "No plan" from the
// server is an answer, not a failure, so it never falls back to a stale cache.
export async function loadPlanBundle(userId: string): Promise<PlanBundle | null> {
  try {
    const bundle = await fetchPlanBundle(userId);
    if (bundle) await writeCache(userId, 'plan', bundle);
    return bundle;
  } catch (error) {
    const cached = await readCache<PlanBundle>(userId, 'plan');
    if (cached) return cached;
    throw error;
  }
}

// Reads the plan from the server and replaces the cached copy. Unlike loadPlanBundle it never falls back to the
// cache: it is for the moment the plan is known to have changed (for example a coach proposal was accepted),
// when showing the old copy as current would be wrong. A failure is thrown so the caller can say so.
export async function refreshPlanBundle(userId: string): Promise<PlanBundle | null> {
  const bundle = await fetchPlanBundle(userId);
  if (bundle) await writeCache(userId, 'plan', bundle);
  return bundle;
}

export async function loadLoggedSets(userId: string, date: string): Promise<LoggedSet[]> {
  const { data, error } = await supabase
    .from('workout_logs')
    .select('id, exercise_id, set_number, reps, weight_kg')
    .eq('user_id', userId)
    .eq('log_date', date);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapLoggedSet);
}
