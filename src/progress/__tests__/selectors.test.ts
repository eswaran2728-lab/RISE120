import { deriveProgress, ProgressInput } from '../selectors';
import type { Plan, PlanDay } from '../../plan/types';
import type { PendingOperation } from '../../sync/types';

const plan: Plan = { id: 'p1', startDate: '2026-10-13', status: 'active' };
// Workout on days 1, 3, 5 of each week; rest otherwise (matches the generator).
const days: PlanDay[] = Array.from({ length: 120 }, (_, i) => ({
  dayNumber: i + 1,
  workout: [0, 2, 4].includes(i % 7)
    ? { kind: 'workout' as const, exercises: [{ exercise_id: 'e1', sets: 2, reps: 10 }] }
    : { kind: 'rest' as const },
  calorieTarget: null,
  proteinTargetG: 100,
}));

const base = (overrides: Partial<ProgressInput> = {}): ProgressInput => ({
  userId: 'u1',
  plan,
  days,
  today: '2026-10-15',
  workoutLogs: [],
  checkins: [],
  pending: [],
  ...overrides,
});

const checkin = (date: string, weightKg: number | null, extra = {}) => ({
  date,
  weightKg,
  mood: 3,
  sleepHours: 7,
  photoPath: null,
  ...extra,
});

const pendingCheckin = (date: string, weightKg: number, extra = {}): PendingOperation => ({
  kind: 'checkin',
  date,
  weightKg,
  mood: 4,
  sleepHours: 8,
  photoUri: null,
  updatedAt: 1,
  ...extra,
});

describe('calendar', () => {
  it('has exactly 120 cells, day 1 on the start date and day 120 on the last', () => {
    const { calendar } = deriveProgress(base());

    expect(calendar).toHaveLength(120);
    expect(calendar[0]).toMatchObject({ dayNumber: 1, date: '2026-10-13' });
    expect(calendar[119]).toMatchObject({ dayNumber: 120, date: '2027-02-09' });
  });

  it('marks today, past and future days by the local date', () => {
    const { calendar } = deriveProgress(base({ today: '2026-10-15' }));

    expect(calendar[0].state).toBe('missed'); // day 1, nothing logged
    expect(calendar[2]).toMatchObject({ isToday: true });
    expect(calendar[3].state).toBe('upcoming');
  });

  it('does not shift a day across the local midnight boundary', () => {
    expect(deriveProgress(base({ today: '2026-10-13' })).calendar[0].isToday).toBe(true);
    expect(deriveProgress(base({ today: '2026-10-14' })).calendar[0].isToday).toBe(false);
    expect(deriveProgress(base({ today: '2026-10-14' })).calendar[1].isToday).toBe(true);
  });

  it('marks a workout day complete only with both a workout and a check-in', () => {
    const logs = [{ id: 's1', date: '2026-10-13' }];

    expect(deriveProgress(base({ workoutLogs: logs })).calendar[0].state).toBe('partial');
    expect(deriveProgress(base({ workoutLogs: logs, checkins: [checkin('2026-10-13', 70)] })).calendar[0].state).toBe('complete');
    expect(deriveProgress(base({ checkins: [checkin('2026-10-13', 70)] })).calendar[0].state).toBe('partial');
  });

  it('marks a rest day complete with just a check-in', () => {
    const { calendar } = deriveProgress(base({ checkins: [checkin('2026-10-14', 70)] }));

    expect(calendar[1].state).toBe('complete'); // day 2 is a rest day
  });

  it('keeps pending entries visible and marked pending on the calendar', () => {
    const { calendar } = deriveProgress(base({ pending: [pendingCheckin('2026-10-14', 70)] }));

    expect(calendar[1]).toMatchObject({ state: 'complete', pending: true });
  });

  it('is empty-safe before the plan starts and after it ends', () => {
    expect(deriveProgress(base({ today: '2026-10-01' })).calendar.every((c) => c.state === 'upcoming')).toBe(true);
    expect(deriveProgress(base({ today: '2027-03-01' })).calendar.every((c) => c.state !== 'upcoming' && !c.isToday)).toBe(true);
  });
});

describe('weight points', () => {
  it('lists sparse weights in date order and skips check-ins without a weight', () => {
    const { weightPoints } = deriveProgress(
      base({ checkins: [checkin('2026-10-20', 69.5), checkin('2026-10-13', 70.5), checkin('2026-10-16', null)] })
    );

    expect(weightPoints).toEqual([
      { date: '2026-10-13', weightKg: 70.5, pending: false },
      { date: '2026-10-20', weightKg: 69.5, pending: false },
    ]);
  });

  it('shows a date once when the server row and a pending edit overlap, preferring the pending value', () => {
    const { weightPoints, history } = deriveProgress(
      base({ checkins: [checkin('2026-10-13', 70)], pending: [pendingCheckin('2026-10-13', 71)] })
    );

    expect(weightPoints).toEqual([{ date: '2026-10-13', weightKg: 71, pending: true }]);
    expect(history).toHaveLength(1);
  });

  it('is empty with no check-ins', () => {
    expect(deriveProgress(base()).weightPoints).toEqual([]);
  });
});

describe('history and photos', () => {
  it('lists check-ins newest first with mood and sleep', () => {
    const { history } = deriveProgress(base({ checkins: [checkin('2026-10-13', 70), checkin('2026-10-15', 69)] }));

    expect(history.map((h) => h.date)).toEqual(['2026-10-15', '2026-10-13']);
    expect(history[0]).toMatchObject({ weightKg: 69, mood: 3, sleepHours: 7, pending: false });
  });

  it('builds a photo timeline from private photo paths, oldest first', () => {
    const { photos } = deriveProgress(
      base({
        checkins: [
          checkin('2026-10-15', 69, { photoPath: 'u1/2026-10-15.jpg' }),
          checkin('2026-10-13', 70, { photoPath: 'u1/2026-10-13.jpg' }),
          checkin('2026-10-14', 70, {}),
        ],
      })
    );

    expect(photos.map((p) => p.date)).toEqual(['2026-10-13', '2026-10-15']);
    expect(photos[0]).toMatchObject({ path: 'u1/2026-10-13.jpg', localUri: null, pending: false });
  });

  it('shows a pending local photo once, marked pending', () => {
    const { photos } = deriveProgress(
      base({ pending: [pendingCheckin('2026-10-14', 70, { photoUri: 'file:///docs/p.jpg' })] })
    );

    expect(photos).toEqual([{ date: '2026-10-14', path: null, localUri: 'file:///docs/p.jpg', pending: true }]);
  });

  it('keeps the uploaded server photo when a pending edit has no new photo', () => {
    const { photos } = deriveProgress(
      base({
        checkins: [checkin('2026-10-14', 70, { photoPath: 'u1/2026-10-14.jpg' })],
        pending: [pendingCheckin('2026-10-14', 71)],
      })
    );

    expect(photos).toEqual([{ date: '2026-10-14', path: 'u1/2026-10-14.jpg', localUri: null, pending: false }]);
  });

  it('never shows a photo that belongs to another user', () => {
    const { photos, history } = deriveProgress(
      base({ checkins: [checkin('2026-10-13', 70, { photoPath: 'someone-else/2026-10-13.jpg' })] })
    );

    expect(photos).toEqual([]);
    expect(history[0].photoPath).toBeNull();
  });
});
