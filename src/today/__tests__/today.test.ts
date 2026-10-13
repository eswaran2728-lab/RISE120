import { checkinStreak, deriveToday } from '../selectors';
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
