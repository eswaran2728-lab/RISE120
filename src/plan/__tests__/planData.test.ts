import { mapExercise, mapLoggedSet, mapPlan, mapPlanDay } from '../planData';

jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

describe('plan row mappers', () => {
  it('maps a plan row', () => {
    expect(mapPlan({ id: 'p1', start_date: '2026-10-13', status: 'active' })).toEqual({
      id: 'p1',
      startDate: '2026-10-13',
      status: 'active',
    });
  });

  it('maps a plan day, keeping a missing calorie target as null', () => {
    expect(
      mapPlanDay({ day_number: 3, workout: { kind: 'rest' }, calorie_target: null, protein_target_g: 125 })
    ).toEqual({ dayNumber: 3, workout: { kind: 'rest' }, calorieTarget: null, proteinTargetG: 125 });
  });

  it('treats an unknown workout shape as a rest day instead of crashing', () => {
    expect(mapPlanDay({ day_number: 1, workout: null, calorie_target: 2000, protein_target_g: 100 }).workout).toEqual({ kind: 'rest' });
    expect(mapPlanDay({ day_number: 1, workout: { nope: 1 }, calorie_target: 2000, protein_target_g: 100 }).workout).toEqual({ kind: 'rest' });
  });

  it('maps an exercise row', () => {
    expect(
      mapExercise({ id: 'e1', name: 'Plank', muscle_group: 'core', equipment: 'gym', instructions: 'Hold.' })
    ).toEqual({ id: 'e1', name: 'Plank', muscleGroup: 'core', equipment: 'gym', instructions: 'Hold.' });
  });

  it('maps a logged set, converting numeric strings from the database', () => {
    expect(mapLoggedSet({ id: 's1', exercise_id: 'e1', set_number: 2, reps: 8, weight_kg: '22.5' })).toEqual({
      id: 's1',
      exerciseId: 'e1',
      setNumber: 2,
      reps: 8,
      weightKg: 22.5,
    });
  });
});
