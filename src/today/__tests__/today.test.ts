import { checkinStreak, deriveToday, isWorkoutComplete } from '../selectors';
import type { GuidedProgress } from '../../workout/guidedProgress';
import type { PlanDay } from '../../plan/types';

const workoutDay: PlanDay = {
  dayNumber: 3,
  workout: {
    kind: 'workout',
    exercises: [
      { exercise_id: 'a', sets: 2, reps: 10 },
      { exercise_id: 'b', sets: 2, reps: 10 },
    ],
  },
  calorieTarget: 2350,
  proteinTargetG: 140,
};
const restDay: PlanDay = { dayNumber: 2, workout: { kind: 'rest' }, calorieTarget: null, proteinTargetG: 125 };

describe('deriveToday on a workout day', () => {
  it('starts at zero with nothing done', () => {
    expect(deriveToday(workoutDay, [], false)).toMatchObject({
      dayNumber: 3,
      kind: 'workout',
      plannedSets: 4,
      completedSets: 0,
      ringProgress: 0,
      checkinDone: false,
    });
  });

  it('counts the workout and the check-in as half each', () => {
    const allSets = [{ exerciseId: 'a' }, { exerciseId: 'a' }, { exerciseId: 'b' }, { exerciseId: 'b' }];

    expect(deriveToday(workoutDay, allSets, false).ringProgress).toBe(0.5);
    expect(deriveToday(workoutDay, [], true).ringProgress).toBe(0.5);
    expect(deriveToday(workoutDay, allSets, true).ringProgress).toBe(1);
  });

  it('shows partial workout progress inside its half', () => {
    expect(deriveToday(workoutDay, [{ exerciseId: 'a' }], false).ringProgress).toBe(0.125);
    expect(deriveToday(workoutDay, [{ exerciseId: 'a' }, { exerciseId: 'b' }], false).ringProgress).toBe(0.25);
  });

  it('does not count extra sets beyond the plan or sets from other exercises', () => {
    const extra = [
      { exerciseId: 'a' }, { exerciseId: 'a' }, { exerciseId: 'a' }, { exerciseId: 'a' },
      { exerciseId: 'zzz' },
    ];

    const state = deriveToday(workoutDay, extra, false);

    expect(state.completedSets).toBe(2);
    expect(state.ringProgress).toBe(0.25);
  });

  it('passes the targets through, keeping a missing calorie target null', () => {
    expect(deriveToday(workoutDay, [], false)).toMatchObject({ calorieTarget: 2350, proteinTargetG: 140 });
    expect(deriveToday(restDay, [], false)).toMatchObject({ calorieTarget: null, proteinTargetG: 125 });
  });
});

describe('deriveToday on a rest day', () => {
  it('uses the check-in alone for the ring', () => {
    expect(deriveToday(restDay, [], false)).toMatchObject({ kind: 'rest', ringProgress: 0, plannedSets: 0 });
    expect(deriveToday(restDay, [], true).ringProgress).toBe(1);
  });
});

describe('checkinStreak', () => {
  it('counts consecutive days ending today', () => {
    expect(checkinStreak(['2026-10-13', '2026-10-12', '2026-10-11'], '2026-10-13')).toBe(3);
  });

  it('stops at a missed day', () => {
    expect(checkinStreak(['2026-10-13', '2026-10-12', '2026-10-10'], '2026-10-13')).toBe(2);
  });

  it('keeps yesterday streak alive until today is over', () => {
    expect(checkinStreak(['2026-10-12', '2026-10-11'], '2026-10-13')).toBe(2);
  });

  it('is zero when the last check-in was before yesterday', () => {
    expect(checkinStreak(['2026-10-10'], '2026-10-13')).toBe(0);
    expect(checkinStreak([], '2026-10-13')).toBe(0);
  });

  it('ignores duplicates and future dates, and is unordered-input safe', () => {
    expect(checkinStreak(['2026-10-11', '2026-10-13', '2026-10-13', '2026-10-12', '2026-10-20'], '2026-10-13')).toBe(3);
  });

  it('works across month and year boundaries', () => {
    expect(checkinStreak(['2027-01-01', '2026-12-31', '2026-12-30'], '2027-01-01')).toBe(3);
  });

  it('does not shift at the local midnight boundary', () => {
    expect(checkinStreak(['2026-10-13'], '2026-10-14')).toBe(1);
    expect(checkinStreak(['2026-10-13'], '2026-10-15')).toBe(0);
  });
});

// A guided session of two exercises, linked to the logged-set exercises g1 and g2 (2 sets each).
const guided = (status: 'active' | 'completed' = 'active'): GuidedProgress => ({ sessionId: 'sess-1', status, planned: [{ exerciseId: 'g1', sets: 2 }, { exerciseId: 'g2', sets: 2 }] });
const inSession = (...ids: string[]) => ids.map((exerciseId) => ({ exerciseId, sessionId: 'sess-1' }));
const regular = (...ids: string[]) => ids.map((exerciseId) => ({ exerciseId }));

describe('deriveToday with a guided session', () => {
  it('counts a finished guided session as the workout for the day', () => {
    const state = deriveToday(workoutDay, inSession('g1', 'g1', 'g2', 'g2'), false, guided());

    expect(state.workoutComplete).toBe(true);
    expect(state.ringProgress).toBe(0.5);
    expect([state.completedSets, state.plannedSets]).toEqual([4, 4]);
  });

  it('counts a session finished by the member as done even with fewer sets than planned', () => {
    const state = deriveToday(workoutDay, inSession('g1'), false, guided('completed'));

    expect(state.workoutComplete).toBe(true);
    expect(state.ringProgress).toBe(0.5);
  });

  it('does not count a session that was only started', () => {
    const state = deriveToday(workoutDay, [], false, guided());

    expect(state.workoutComplete).toBe(false);
    expect(state.ringProgress).toBe(0);
  });

  it('shows partial guided sets as partial progress inside the workout half', () => {
    const state = deriveToday(workoutDay, inSession('g1', 'g2'), false, guided());

    expect(state.workoutComplete).toBe(false);
    expect(state.ringProgress).toBe(0.25);
    expect([state.completedSets, state.plannedSets]).toEqual([2, 4]);
  });

  it('does not count extra guided sets of one exercise in place of a missing one', () => {
    expect(deriveToday(workoutDay, inSession('g1', 'g1', 'g1', 'g1'), false, guided()).workoutComplete).toBe(false);
  });

  it('keeps the regular workout working exactly as before when there is no guided session', () => {
    const state = deriveToday(workoutDay, regular('a', 'a', 'b', 'b'), true, null);

    expect(state).toMatchObject({ workoutComplete: true, ringProgress: 1, completedSets: 4, plannedSets: 4 });
  });

  it('never counts the day twice when both paths are used: the ring is the better path, not the sum', () => {
    const both = deriveToday(workoutDay, [...regular('a', 'a', 'b', 'b'), ...inSession('g1', 'g1', 'g2', 'g2')], false, guided('completed'));

    expect(both.ringProgress).toBe(0.5);
    expect(both.workoutComplete).toBe(true);
    // half of each does not add up to a whole workout
    const halves = deriveToday(workoutDay, [...regular('a', 'b'), ...inSession('g1', 'g2')], false, guided());
    expect(halves.workoutComplete).toBe(false);
    expect(halves.ringProgress).toBe(0.25);
  });

  it('does not let guided sets of an exercise that is also in the plan inflate the regular count', () => {
    // the guided squat is the same logged-set exercise as plan exercise a: it must not count towards the regular workout
    const asRegular = deriveToday(workoutDay, [{ exerciseId: 'a', sessionId: 'sess-1' }, { exerciseId: 'a', sessionId: 'sess-1' }], false, null);

    expect(asRegular.completedSets).toBe(0);
  });

  it('ignores sets that belong to a different session', () => {
    const state = deriveToday(workoutDay, [{ exerciseId: 'g1', sessionId: 'other' }, { exerciseId: 'g2', sessionId: 'other' }], false, guided());

    expect(state.completedSets).toBe(0);
  });

  it('is unchanged on a rest day, whatever a guided session says', () => {
    expect(deriveToday(restDay, [], false, guided('completed'))).toMatchObject({ kind: 'rest', workoutComplete: false, ringProgress: 0 });
  });
});

describe('isWorkoutComplete (the one definition Today and the reminders share)', () => {
  it('agrees with deriveToday for regular, guided and mixed use', () => {
    expect(isWorkoutComplete(workoutDay, regular('a', 'a', 'b', 'b'), null)).toBe(true);
    expect(isWorkoutComplete(workoutDay, regular('a'), null)).toBe(false);
    expect(isWorkoutComplete(workoutDay, inSession('g1', 'g1', 'g2', 'g2'), guided())).toBe(true);
    expect(isWorkoutComplete(workoutDay, inSession('g1'), guided())).toBe(false);
    expect(isWorkoutComplete(workoutDay, [], guided('completed'))).toBe(true);
    expect(isWorkoutComplete(workoutDay, [], guided())).toBe(false);
  });
});

