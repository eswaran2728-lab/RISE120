import { isWorkoutComplete } from '../../today/selectors';
import { loadGuidedProgress } from '../../workout/guidedProgress';
import { workoutCompleteToday } from '../completion';
import { loadPlanBundle } from '../../plan/planData';
import { loadSessionSets } from '../../workout/session';
import type { PlanBundle } from '../../plan/planData';
import type { PlanDay } from '../../plan/types';

jest.mock('../../plan/planData', () => ({ loadPlanBundle: jest.fn() }));
jest.mock('../../workout/session', () => ({ loadSessionSets: jest.fn() }));
jest.mock('../../workout/guidedProgress', () => ({ loadGuidedProgress: jest.fn() }));

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
  beforeEach(() => {
    jest.resetAllMocks();
    (loadGuidedProgress as jest.Mock).mockResolvedValue(null);
  });

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

describe('workoutCompleteToday with a guided session', () => {
  const bundle = (days: PlanDay[]): PlanBundle => ({ plan: { id: 'plan-1', startDate: '2026-10-16', status: 'active' }, days, exercises: [] } as unknown as PlanBundle);
  const guided = (status: 'active' | 'completed') => ({ sessionId: 'sess-1', status, planned: [{ exerciseId: 'g1', sets: 2 }] });
  beforeEach(() => {
    jest.resetAllMocks();
    (loadPlanBundle as jest.Mock).mockResolvedValue(bundle([workoutDay]));
    (loadSessionSets as jest.Mock).mockResolvedValue([]);
    (loadGuidedProgress as jest.Mock).mockResolvedValue(null);
  });

  it('asks about the guided session of this account, plan and day', async () => {
    await workoutCompleteToday('u1', '2026-10-18');

    expect(loadGuidedProgress).toHaveBeenCalledWith('u1', 'plan-1', 3);
  });

  it('is true once the guided session was finished', async () => {
    (loadGuidedProgress as jest.Mock).mockResolvedValue(guided('completed'));

    expect(await workoutCompleteToday('u1', '2026-10-18')).toBe(true);
  });

  it('is true when every planned guided set is logged, including sets still waiting to sync', async () => {
    (loadGuidedProgress as jest.Mock).mockResolvedValue(guided('active'));
    (loadSessionSets as jest.Mock).mockResolvedValue([{ exerciseId: 'g1', sessionId: 'sess-1' }, { exerciseId: 'g1', sessionId: 'sess-1' }]);

    expect(await workoutCompleteToday('u1', '2026-10-18')).toBe(true);
  });

  it('is false for a guided session that was only started, or has some of its sets', async () => {
    (loadGuidedProgress as jest.Mock).mockResolvedValue(guided('active'));
    expect(await workoutCompleteToday('u1', '2026-10-18')).toBe(false);

    (loadSessionSets as jest.Mock).mockResolvedValue([{ exerciseId: 'g1', sessionId: 'sess-1' }]);
    expect(await workoutCompleteToday('u1', '2026-10-18')).toBe(false);
  });

  it('still answers from the regular workout when the guided session cannot be read', async () => {
    (loadGuidedProgress as jest.Mock).mockRejectedValue(new Error('offline'));
    (loadSessionSets as jest.Mock).mockResolvedValue([{ exerciseId: 'a' }, { exerciseId: 'a' }, { exerciseId: 'b' }]);

    expect(await workoutCompleteToday('u1', '2026-10-18')).toBe(true);
  });
});

