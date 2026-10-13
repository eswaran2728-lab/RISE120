import { buildPlanDays, NUTRITION_RULES } from '../functions/_shared/plan/generate';
import type { Equipment, Exercise, Goal, Level, PlanProfile } from '../functions/_shared/plan/types';

const PATTERNS = ['squat', 'hinge', 'push', 'pull', 'core'];
const NAMES: Record<Equipment, string[]> = {
  gym: ['Goblet squat', 'Dumbbell Romanian deadlift', 'Chest press machine', 'Seated cable row', 'Plank'],
  home: ['Chair squat', 'Unloaded hip hinge', 'Countertop incline push-up', 'Prone W raise', 'Dead bug'],
  none: ['Bodyweight squat', 'Glute bridge', 'Wall push-up', 'Prone W raise', 'Dead bug'],
};

const exercises: Exercise[] = (Object.keys(NAMES) as Equipment[]).flatMap((equipment) =>
  NAMES[equipment].map((name, index) => ({
    id: `${equipment}-${index}`,
    name,
    muscle_group: PATTERNS[index],
    equipment,
    instructions: `How to do ${name}`,
  }))
);

const base: PlanProfile = {
  age: 30,
  heightCm: 175,
  weightKg: 70,
  goal: 'recomp',
  trainingLevel: 'beginner',
  equipment: 'gym',
  energySex: 'male',
  activityLevel: 'light',
};

const build = (overrides: Partial<PlanProfile> = {}, list: Exercise[] = exercises) =>
  buildPlanDays({ ...base, ...overrides }, '2026-10-13', list, NUTRITION_RULES);

describe('buildPlanDays structure', () => {
  it('returns exactly 120 ordered days dated from the start date', () => {
    const days = build();

    expect(days).toHaveLength(120);
    expect(days.map((d) => d.day_number)).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
    expect(days[0].date).toBe('2026-10-13');
    expect(days[119].date).toBe('2027-02-09');
  });

  it('schedules full-body workouts on days 1, 3 and 5 of every seven-day block', () => {
    const days = build();
    const workoutDays = days.filter((d) => d.workout.kind === 'workout').map((d) => d.day_number);

    expect(workoutDays.slice(0, 7)).toEqual([1, 3, 5, 8, 10, 12, 15]);
    expect(workoutDays).toHaveLength(52);
    expect(days[1].workout).toEqual({ kind: 'rest' });
    expect(days[5].workout).toEqual({ kind: 'rest' });
    expect(days[6].workout).toEqual({ kind: 'rest' });
  });

  it('is deterministic and ignores the order of the exercise list', () => {
    expect(build()).toEqual(build());
    expect(build({}, [...exercises].reverse())).toEqual(build());
  });

  it('rejects a malformed start date', () => {
    expect(() => buildPlanDays(base, '13/10/2026', exercises, NUTRITION_RULES)).toThrow();
  });
});

describe('workout prescription', () => {
  const goals: [Goal, number][] = [['lose_fat', 12], ['build_muscle', 8], ['recomp', 10]];
  const levels: [Level, number][] = [['beginner', 2], ['intermediate', 3], ['advanced', 4]];
  const equipments: Equipment[] = ['gym', 'home', 'none'];

  const combos = goals.flatMap(([goal, reps]) =>
    levels.flatMap(([trainingLevel, sets]) => equipments.map((equipment) => [goal, trainingLevel, equipment, sets, reps] as const))
  );

  it.each(combos)('%s / %s / %s uses %i sets of %i reps from that equipment group only', (goal, trainingLevel, equipment, sets, reps) => {
    const days = build({ goal, trainingLevel, equipment });
    const day1 = days[0].workout;
    if (day1.kind !== 'workout') throw new Error('day 1 must be a workout');

    expect(day1.exercises).toHaveLength(5);
    expect(day1.exercises.map((e) => e.exercise_id)).toEqual(NAMES[equipment].map((_, i) => `${equipment}-${i}`));
    for (const entry of day1.exercises) {
      expect(entry.sets).toBe(sets);
      expect(entry.reps).toBe(reps);
      expect(exercises.find((e) => e.id === entry.exercise_id)?.equipment).toBe(equipment);
    }
    for (const day of days) {
      if (day.workout.kind === 'workout') expect(day.workout).toEqual(day1);
    }
  });

  it('throws when the equipment group lacks a movement pattern', () => {
    const missingPull = exercises.filter((e) => !(e.equipment === 'gym' && e.muscle_group === 'pull'));

    expect(() => build({ equipment: 'gym' }, missingPull)).toThrow(/pull/);
  });
});

describe('nutrition targets', () => {
  const target = (overrides: Partial<PlanProfile>) => {
    const day = build(overrides)[0];
    return { calories: day.calorie_target, protein: day.protein_target_g };
  };

  it('computes the male light-activity example for each goal', () => {
    // BMR = 10*70 + 6.25*175 - 5*30 + 5 = 1648.75; x1.6 = 2638
    expect(target({ goal: 'lose_fat' })).toEqual({ calories: 2350, protein: 140 });
    expect(target({ goal: 'build_muscle' })).toEqual({ calories: 2850, protein: 110 });
    expect(target({ goal: 'recomp' })).toEqual({ calories: 2650, protein: 125 });
  });

  it('uses the female offset and sedentary multiplier', () => {
    // BMR = 600 + 1031.25 - 150 - 161 = 1320.25; x1.4 = 1848.35
    expect(target({ energySex: 'female', activityLevel: 'sedentary', heightCm: 165, weightKg: 60, goal: 'recomp' }).calories).toBe(1850);
  });

  it('applies the active multiplier', () => {
    // 1648.75 x 1.8 = 2967.75
    expect(target({ activityLevel: 'active' }).calories).toBe(2950);
  });

  it('leaves calories null for undisclosed sex but still gives protein', () => {
    expect(target({ energySex: 'undisclosed' })).toEqual({ calories: null, protein: 125 });
  });

  it('leaves calories null when sex or activity is missing', () => {
    expect(target({ energySex: null }).calories).toBeNull();
    expect(target({ activityLevel: null }).calories).toBeNull();
  });

  it('leaves calories null when the estimate falls below 1,500 kcal', () => {
    const result = target({ energySex: 'female', activityLevel: 'sedentary', age: 50, heightCm: 150, weightKg: 45 });

    expect(result.calories).toBeNull();
    expect(result.protein).toBeGreaterThan(0);
  });

  it('puts the same targets on every day', () => {
    const days = build();

    expect(new Set(days.map((d) => `${d.calorie_target}/${d.protein_target_g}`)).size).toBe(1);
  });
});
