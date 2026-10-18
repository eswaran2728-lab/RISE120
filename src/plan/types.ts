import type { LocalDate } from '../sync/types';

export interface Plan {
  id: string;
  startDate: LocalDate;
  status: string;
  cycleNumber?: number; // 1 for the first cycle; absent in plans saved before cycles existed
}

export interface WorkoutEntry {
  exercise_id: string;
  sets: number;
  reps: number;
}

export type PlanWorkout = { kind: 'rest' } | { kind: 'workout'; exercises: WorkoutEntry[] };

export interface PlanDay {
  dayNumber: number;
  workout: PlanWorkout;
  calorieTarget: number | null;
  proteinTargetG: number | null;
}

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string;
  instructions: string;
}
