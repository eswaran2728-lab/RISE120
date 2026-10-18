import { summaryInputFrom } from '../summaryData';
import type { ProgressInput } from '../selectors';
import type { PendingOperation } from '../../sync/types';

const input = (over: Partial<ProgressInput> = {}): ProgressInput => ({
  userId: 'A',
  plan: { id: 'p', startDate: '2026-06-01', status: 'active' },
  days: [],
  today: '2026-10-18',
  workoutLogs: [],
  checkins: [],
  pending: [],
  ...over,
});
const set = (id: string, date: string, exerciseId = 'squat', weightKg = 20): PendingOperation =>
  ({ kind: 'workout_set', id, date, exerciseId, setNumber: 1, reps: 10, weightKg, updatedAt: 1 }) as PendingOperation;
const checkin = (date: string, weightKg: number | null): PendingOperation =>
  ({ kind: 'checkin', date, weightKg, mood: 3, sleepHours: 7, photoUri: null, updatedAt: 1 }) as PendingOperation;

describe('summaryInputFrom', () => {
  it('uses the server logs with their exercise, reps and weight', () => {
    const result = summaryInputFrom(input({ workoutLogs: [{ id: 's1', date: '2026-10-13', exerciseId: 'squat', reps: 10, weightKg: 25 }] }), true);

    expect(result.logs).toEqual([{ id: 's1', date: '2026-10-13', exerciseId: 'squat', reps: 10, weightKg: 25 }]);
  });

  it('adds sets still waiting to sync, once, even when the same set is already on the server', () => {
    const result = summaryInputFrom(input({ workoutLogs: [{ id: 's1', date: '2026-10-13', exerciseId: 'squat', reps: 10, weightKg: 25 }], pending: [set('s1', '2026-10-13'), set('s2', '2026-10-14')] }), true);

    expect(result.logs.map((l) => l.id).sort()).toEqual(['s1', 's2']);
  });

  it('adds check-ins from the server and the ones waiting, with the waiting one winning for the same day', () => {
    const result = summaryInputFrom(input({ checkins: [{ date: '2026-10-12', weightKg: 71, mood: 3, sleepHours: 7, photoPath: null }], pending: [checkin('2026-10-12', 70.5), checkin('2026-10-13', null)] }), true);

    expect(result.checkins).toEqual([
      { date: '2026-10-12', weightKg: 70.5 },
      { date: '2026-10-13', weightKg: null },
    ]);
  });

  it('counts everything waiting to sync, of any kind, so the summary can say it may be incomplete', () => {
    const food = { kind: 'food_log', id: 'f1', date: '2026-10-13', updatedAt: 1 } as unknown as PendingOperation;

    expect(summaryInputFrom(input({ pending: [set('s1', '2026-10-13'), checkin('2026-10-13', 70), food] }), true).pendingOps).toBe(3);
  });

  it('passes on the member\'s choice to show or hide body measurements, and the date', () => {
    expect(summaryInputFrom(input(), false)).toMatchObject({ showBodyMetrics: false, today: '2026-10-18' });
    expect(summaryInputFrom(input(), true).showBodyMetrics).toBe(true);
  });
});
