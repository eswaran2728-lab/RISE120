import { mockStore } from '../../sync/testing/storageMock';
import { enqueue } from '../../sync/queue';
import { supabase } from '../../lib/supabase';
import { loadWorkoutDates } from '../load';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const eq = jest.fn();

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  eq.mockResolvedValue({ data: [{ log_date: '2026-10-12' }, { log_date: '2026-10-12' }, { log_date: '2026-10-10' }], error: null });
  (supabase.from as jest.Mock).mockReturnValue({ select: () => ({ eq }) });
});

describe('loadWorkoutDates', () => {
  it('returns each day that has a logged set once', async () => {
    expect((await loadWorkoutDates('u1')).sort()).toEqual(['2026-10-10', '2026-10-12']);
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('adds sets still waiting to sync, once', async () => {
    await enqueue('u1', { kind: 'workout_set', id: 's1', date: '2026-10-13', exerciseId: 'e1', setNumber: 1, reps: 8, weightKg: 20, updatedAt: 1 } as never);
    await enqueue('u1', { kind: 'workout_set', id: 's2', date: '2026-10-13', exerciseId: 'e1', setNumber: 2, reps: 8, weightKg: 20, updatedAt: 1 } as never);

    expect((await loadWorkoutDates('u1')).sort()).toEqual(['2026-10-10', '2026-10-12', '2026-10-13']);
  });

  it('falls back to what is waiting when the server cannot be reached', async () => {
    eq.mockRejectedValue(new Error('Network request failed'));
    await enqueue('u1', { kind: 'workout_set', id: 's1', date: '2026-10-13', exerciseId: 'e1', setNumber: 1, reps: 8, weightKg: 20, updatedAt: 1 } as never);

    expect(await loadWorkoutDates('u1')).toEqual(['2026-10-13']);
  });
});
