export type Goal = 'lose_fat' | 'build_muscle' | 'recomp';
export type Level = 'beginner' | 'intermediate' | 'advanced';
export type Equipment = 'gym' | 'home' | 'none';
export type EnergySex = 'male' | 'female' | 'undisclosed';
export type ActivityLevel = 'sedentary' | 'light' | 'active';

export interface PlanProfile {
  age: number;
  heightCm: number;
  weightKg: number;
  goal: Goal;
  trainingLevel: Level;
  equipment: Equipment;
  energySex: EnergySex | null;
  activityLevel: ActivityLevel | null;
}

// muscle_group holds the movement pattern: squat, hinge, push, pull or core.
export interface Exercise {
  id: string;
  name: string;
  muscle_group: string;
  equipment: string;
  instructions: string;
}

export interface WorkoutEntry {
  exercise_id: string;
  sets: number;
  reps: number;
}

// Stored as plan_days.workout (jsonb).
export type PlanWorkout = { kind: 'rest' } | { kind: 'workout'; exercises: WorkoutEntry[] };

export interface PlanDayDraft {
  day_number: number;
  date: string; // YYYY-MM-DD; derived from the start date, not a column
  workout: PlanWorkout;
  calorie_target: number | null;
  protein_target_g: number;
}

export interface NutritionRules {
  sexOffset: { male: number; female: number };
  activityMultiplier: Record<ActivityLevel, number>;
  goalAdjustmentKcal: Record<Goal, number>;
  proteinPerKg: Record<Goal, number>;
  minCalories: number;
  calorieRounding: number;
  proteinRounding: number;
}
