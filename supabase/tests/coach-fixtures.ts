// Shared fixtures for the coach unit tests (not a test file).
import type { CoachContext, CoachExercise, CoachPlanDay } from '../functions/_shared/coach/types';

export const EX = {
  squat1: '00000000-0000-4000-8000-000000000001',
  squat2: '00000000-0000-4000-8000-000000000002',
  hinge1: '00000000-0000-4000-8000-000000000003',
  push1: '00000000-0000-4000-8000-000000000004',
  pull1: '00000000-0000-4000-8000-000000000005',
  core1: '00000000-0000-4000-8000-000000000006',
  homeSquat: '00000000-0000-4000-8000-000000000007',
  core2: '00000000-0000-4000-8000-000000000008',
  ghost: '00000000-0000-4000-8000-0000000000ff',
};

export const exercises: CoachExercise[] = [
  { id: EX.squat1, name: 'Barbell squat', pattern: 'squat', equipment: 'gym' },
  { id: EX.squat2, name: 'Leg press', pattern: 'squat', equipment: 'gym' },
  { id: EX.hinge1, name: 'Romanian deadlift', pattern: 'hinge', equipment: 'gym' },
  { id: EX.push1, name: 'Bench press', pattern: 'push', equipment: 'gym' },
  { id: EX.pull1, name: 'Lat pulldown', pattern: 'pull', equipment: 'gym' },
  { id: EX.core1, name: 'Cable crunch', pattern: 'core', equipment: 'gym' },
  { id: EX.core2, name: 'Hanging leg raise', pattern: 'core', equipment: 'gym' },
];

// The context only ever carries the user's own equipment group; this one is kept for the "wrong equipment" case.
export const foreignExercise: CoachExercise = { id: EX.homeSquat, name: 'Goblet squat', pattern: 'squat', equipment: 'home' };

export const workoutEntries = (sets = 2, reps = 10) => [
  { exercise_id: EX.squat1, sets, reps },
  { exercise_id: EX.hinge1, sets, reps },
  { exercise_id: EX.push1, sets, reps },
  { exercise_id: EX.pull1, sets, reps },
  { exercise_id: EX.core1, sets, reps },
];

// Plan days the member may still change: day 5 (workout), 6 (rest), 7 (workout). Today is plan day 3.
export const planDays: CoachPlanDay[] = [
  { dayNumber: 5, date: '2026-10-18', workout: { kind: 'workout', exercises: workoutEntries() }, calorieTarget: 2650, proteinTargetG: 125 },
  { dayNumber: 6, date: '2026-10-19', workout: { kind: 'rest' }, calorieTarget: 2650, proteinTargetG: 125 },
  { dayNumber: 7, date: '2026-10-20', workout: { kind: 'workout', exercises: workoutEntries() }, calorieTarget: 2650, proteinTargetG: 125 },
];

// Male, 30, 175 cm, 70 kg, light activity, recomp: raw estimate 2,638 kcal, rounded target 2,650, protein 125 g.
export const baseContext = (over: Partial<CoachContext> = {}): CoachContext => ({
  language: 'en',
  languageFellBack: false,
  profile: { goal: 'recomp', trainingLevel: 'beginner', equipment: 'gym', weightKg: 70, heightCm: 175, age: 30, energySex: 'male', activityLevel: 'light' },
  checkins: [],
  todayDayNumber: 3,
  planDays,
  exercises,
  ...over,
});
