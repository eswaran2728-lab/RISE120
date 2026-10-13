// Pure plan rules, used by the generate-plan edge function. No client imports this:
// coefficients stay on the server. Approved starting estimates, not prescriptions.
import type { Exercise, NutritionRules, PlanDayDraft, PlanProfile, PlanWorkout } from './types.ts';

const PLAN_DAYS = 120;
const WORKOUT_POSITIONS = [1, 3, 5]; // days of each seven-day block
const PATTERNS = ['squat', 'hinge', 'push', 'pull', 'core'];
const SETS = { beginner: 2, intermediate: 3, advanced: 4 } as const;
const REPS = { lose_fat: 12, build_muscle: 8, recomp: 10 } as const;

export const NUTRITION_RULES: NutritionRules = {
  // Mifflin-St Jeor: 10*kg + 6.25*cm - 5*age + offset.
  sexOffset: { male: 5, female: -161 },
  activityMultiplier: { sedentary: 1.4, light: 1.6, active: 1.8 },
  goalAdjustmentKcal: { lose_fat: -300, build_muscle: 200, recomp: 0 },
  proteinPerKg: { lose_fat: 2.0, build_muscle: 1.6, recomp: 1.8 },
  minCalories: 1500,
  calorieRounding: 50,
  proteinRounding: 5,
};

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

function addDays(startDate: string, days: number): string {
  const [year, month, day] = startDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function calorieTarget(profile: PlanProfile, rules: NutritionRules): number | null {
  const { energySex, activityLevel } = profile;
  if (energySex !== 'male' && energySex !== 'female') return null;
  if (!activityLevel) return null;
  const resting = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age + rules.sexOffset[energySex];
  const target = resting * rules.activityMultiplier[activityLevel] + rules.goalAdjustmentKcal[profile.goal];
  const rounded = roundTo(target, rules.calorieRounding);
  return rounded < rules.minCalories ? null : rounded;
}

function pickExercises(profile: PlanProfile, exercises: Exercise[]): Exercise[] {
  const inGroup = exercises
    .filter((exercise) => exercise.equipment === profile.equipment)
    .sort((a, b) => a.name.localeCompare(b.name));
  return PATTERNS.map((pattern) => {
    const match = inGroup.find((exercise) => exercise.muscle_group === pattern);
    if (!match) throw new Error(`No ${pattern} exercise for equipment ${profile.equipment}`);
    return match;
  });
}

export function buildPlanDays(
  profile: PlanProfile,
  startDate: string,
  exercises: Exercise[],
  nutrition: NutritionRules
): PlanDayDraft[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error(`Invalid start date: ${startDate}`);

  const chosen = pickExercises(profile, exercises);
  const workout: PlanWorkout = {
    kind: 'workout',
    exercises: chosen.map((exercise) => ({
      exercise_id: exercise.id,
      sets: SETS[profile.trainingLevel],
      reps: REPS[profile.goal],
    })),
  };
  const calories = calorieTarget(profile, nutrition);
  const protein = roundTo(nutrition.proteinPerKg[profile.goal] * profile.weightKg, nutrition.proteinRounding);

  return Array.from({ length: PLAN_DAYS }, (_, index) => {
    const dayNumber = index + 1;
    const isWorkoutDay = WORKOUT_POSITIONS.includes((index % 7) + 1);
    return {
      day_number: dayNumber,
      date: addDays(startDate, index),
      workout: isWorkoutDay ? workout : { kind: 'rest' },
      calorie_target: calories,
      protein_target_g: protein,
    };
  });
}
