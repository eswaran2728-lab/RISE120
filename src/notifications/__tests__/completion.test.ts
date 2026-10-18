import { isWorkoutComplete } from '../../today/selectors';
import { workoutCompleteToday } from '../completion';
import { loadPlanBundle } from '../../plan/planData';
import { loadSessionSets } from '../../workout/session';
import type { PlanBundle } from '../../plan/planData';
import type { PlanDay } from '../../plan/types';

jest.mock('../../plan/planData', () => ({ loadPlanBundle: jest.fn() }));
jest.mock('../../workout/session', () => ({ loadSessionSets: jest.fn() }));

const workoutDay: PlanDay = {
  dayNumber: 3,
  workout: {
    kind: 'workout',
    exercises: [
      { exercise_id: 'a', sets: 2, reps: 10 },
      { exercise_id: 'b', sets: 1, reps: 10 },
    ],
  },
  calorieTarget: 2350,
  proteinTargetG: 140,
};
const restDay: PlanDay = { dayNumber: 4, workout: { kind: 'rest' }, calorieTarget: null, proteinTargetG: 125 };
const sets = (...ids: string[]) => ids.map((exerciseId) => ({ exerciseId }));

describe('isWorkoutComplete', () => {
  it('is false after one set, because logging one set is not finishing the workout', () => {
    expect(isWorkoutComplete(workoutDay, sets('a'))).toBe(false);
    expect(isWorkoutComplete(workoutDay, sets('a', 'a'))).toBe(false);
  });

  it('is true once every planned set is logged', () => {
    expect(isWorkoutComplete(workoutDay, sets('a', 'a', 'b'))).toBe(true);
  });

  it('does not count extra sets of one exercise in place of a missing one', () => {
    expect(isWorkoutComplete(workoutDay, sets('a', 'a', 'a', 'a'))).toBe(false);
  });

  it('does not count sets of exercises that are not in the plan', () => {
    expect(isWorkoutComplete(workoutDay, sets('a', 'a', 'z'))).toBe(false);
  });

  it('is false on a rest day, where there is no workout to finish', () => {
    expect(isWorkoutComplete(restDay, [])).toBe(false);
  });
});

describe('workoutCompleteToday', () => {
  const bundle = (days: PlanDay[]): PlanBundle => ({ plan: { id: 'p', startDate: '2026-10-16', status: 'active' }, days, exercises: [] } as unknown as PlanBundle);
  beforeEach(() => jest.resetAllMocks());

  it('reads the plan and the sets for the date, including sets still waiting to sync', async () => {
    (loadPlanBundle as jest.Mock).mockResolvedValue(bundle([{ ...workoutDay, dayNumber: 3 }]));
    (loadSessionSets as jest.Mock).mockResolvedValue(sets('a', 'a', 'b'));

    expect(await workoutCompleteToday('u1', '2026-10-18')).toBe(true);
    expect(loadSessionSets).toHaveBeenCalledWith('u1', '2026-10-18');
  });

  it('is false with part of the workout done', async () => {
    (loadPlanBundle as jest.Mock).mockResolvedValue(bundle([workoutDay]));
    (loadSessionSets as jest.Mock).mockResolvedValue(sets('a'));

    expect(await workoutCompleteToday('u1', '2026-10-18')).toBe(false);
  });

  it('is false when there is no plan or no plan day for the date', async () => {
    (loadPlanBundle as jest.Mock).mockResolvedValue(null);
    expect(await workoutCompleteToday('u1', '2026-10-18')).toBe(false);

    (loadPlanBundle as jest.Mock).mockResolvedValue(bundle([]));
    expect(await workoutCompleteToday('u1', '2026-10-18')).toBe(false);
  });

  it('is false rather than failing when everything is unreadable (offline launch with nothing remembered)', async () => {
    (loadPlanBundle as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    expect(await workoutCompleteToday('u1', '2026-10-18')).toBe(false);
  });
});
