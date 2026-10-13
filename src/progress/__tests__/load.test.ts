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

function mockTables(logs: unknown, checkins: unknown) {
  (supabase.from as jest.Mock).mockImplementation((table: string) => ({
    select: () => ({ eq: async () => (table === 'workout_logs' ? logs : checkins) }),
  }));
}

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
      select: () => ({ eq: async () => { throw new Error('Network request failed'); } }),
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
