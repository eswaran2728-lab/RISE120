import { mockStore } from '../../sync/testing/storageMock';
import { enqueue } from '../../sync/queue';
import { supabase } from '../../lib/supabase';
import { loadPlanBundle } from '../../plan/planData';
import { loadProgress } from '../load';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../plan/planData', () => ({ loadPlanBundle: jest.fn() }));

const bundle = { plan: { id: 'p1', startDate: '2026-10-13', status: 'active' }, days: [], exercises: [] };

// Workout logs are read page by page (select > eq > order > order > range); check-ins in one query.
const logPages = jest.fn();

function tableMock(checkins: unknown) {
  return (table: string) =>
    table === 'workout_logs'
      ? { select: () => ({ eq: () => ({ order: () => ({ order: () => ({ range: logPages }) }) }) }) }
      : { select: () => ({ eq: async () => checkins }) };
}

function mockTables(logs: { data: { id: string; log_date: string }[] | null; error: unknown }, checkins: unknown) {
  logPages.mockImplementation(async (from: number, to: number) =>
    logs.error ? { data: null, error: logs.error } : { data: (logs.data ?? []).slice(from, to + 1), error: null }
  );
  (supabase.from as jest.Mock).mockImplementation(tableMock(checkins));
}

const manyLogs = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `s${String(i).padStart(5, '0')}`, log_date: '2026-10-13' }));

describe('loadProgress', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
    (loadPlanBundle as jest.Mock).mockResolvedValue(bundle);
  });

  it('returns null when the user has no plan', async () => {
    (loadPlanBundle as jest.Mock).mockResolvedValue(null);

    expect(await loadProgress('u1', '2026-10-15')).toBeNull();
  });

  it('maps server rows and includes pending entries', async () => {
    mockTables(
      { data: [{ id: 's1', log_date: '2026-10-13' }], error: null },
      { data: [{ checkin_date: '2026-10-13', weight_kg: '70.5', mood: 4, sleep_hours: '7.5', photo_path: 'u1/2026-10-13.jpg' }], error: null }
    );
    await enqueue('u1', { kind: 'checkin', date: '2026-10-14', weightKg: 70, mood: 3, sleepHours: 7, photoUri: null, updatedAt: 1 });

    const result = await loadProgress('u1', '2026-10-15');

    expect(result).toMatchObject({
      userId: 'u1',
      today: '2026-10-15',
      workoutLogs: [{ id: 's1', date: '2026-10-13' }],
      checkins: [{ date: '2026-10-13', weightKg: 70.5, mood: 4, sleepHours: 7.5, photoPath: 'u1/2026-10-13.jpg' }],
    });
    expect(result?.pending).toHaveLength(1);
  });

  it('still returns the plan and pending entries when the server rows cannot be read', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: () => ({
        eq: () => {
          throw new Error('Network request failed');
        },
      }),
    }));
    await enqueue('u1', { kind: 'checkin', date: '2026-10-14', weightKg: 70, mood: 3, sleepHours: 7, photoUri: null, updatedAt: 1 });

    const result = await loadProgress('u1', '2026-10-15');

    expect(result?.workoutLogs).toEqual([]);
    expect(result?.checkins).toEqual([]);
    expect(result?.pending).toHaveLength(1);
  });

  it('never includes another account pending entries', async () => {
    mockTables({ data: [], error: null }, { data: [], error: null });
    await enqueue('u2', { kind: 'checkin', date: '2026-10-14', weightKg: 70, mood: 3, sleepHours: 7, photoUri: null, updatedAt: 1 });

    expect((await loadProgress('u1', '2026-10-15'))?.pending).toEqual([]);
  });
});

describe('loadProgress pagination', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
    (loadPlanBundle as jest.Mock).mockResolvedValue(bundle);
  });

  it('reads every workout log across pages, not just the first 1,000', async () => {
    mockTables({ data: manyLogs(2350), error: null }, { data: [], error: null });

    const result = await loadProgress('u1', '2026-10-15');

    expect(result?.workoutLogs).toHaveLength(2350);
    expect(logPages.mock.calls.map(([from, to]) => [from, to])).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('stops after a short page without an extra request', async () => {
    mockTables({ data: manyLogs(40), error: null }, { data: [], error: null });

    expect((await loadProgress('u1', '2026-10-15'))?.workoutLogs).toHaveLength(40);
    expect(logPages).toHaveBeenCalledTimes(1);
  });

  it('asks for one more page when the last page is exactly full', async () => {
    mockTables({ data: manyLogs(1000), error: null }, { data: [], error: null });

    expect((await loadProgress('u1', '2026-10-15'))?.workoutLogs).toHaveLength(1000);
    expect(logPages).toHaveBeenCalledTimes(2);
  });

  it('does not return a partial set of logs when a later page fails', async () => {
    logPages
      .mockResolvedValueOnce({ data: manyLogs(1000), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } });
    (supabase.from as jest.Mock).mockImplementation(tableMock({ data: [], error: null }));

    expect((await loadProgress('u1', '2026-10-15'))?.workoutLogs).toEqual([]);
  });
});
