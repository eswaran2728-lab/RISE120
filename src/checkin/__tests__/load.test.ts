import { mockStore } from '../../sync/testing/storageMock';
import { enqueue } from '../../sync/queue';
import { supabase } from '../../lib/supabase';
import { loadCheckin } from '../load';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const maybeSingle = jest.fn();

describe('loadCheckin', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
    maybeSingle.mockResolvedValue({ data: null, error: null });
    (supabase.from as jest.Mock).mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
    });
  });

  it('returns null when there is no check-in for the date', async () => {
    expect(await loadCheckin('u1', '2026-10-13')).toBeNull();
  });

  it('returns the server check-in', async () => {
    maybeSingle.mockResolvedValue({
      data: { weight_kg: '70.5', mood: 4, sleep_hours: '7.5', photo_path: 'u1/2026-10-13.jpg' },
      error: null,
    });

    expect(await loadCheckin('u1', '2026-10-13')).toEqual({
      weightKg: 70.5,
      mood: 4,
      sleepHours: 7.5,
      photoPath: 'u1/2026-10-13.jpg',
      pending: false,
    });
  });

  it('prefers the pending local edit over the server copy', async () => {
    maybeSingle.mockResolvedValue({ data: { weight_kg: 70, mood: 3, sleep_hours: 6, photo_path: null }, error: null });
    await enqueue('u1', { kind: 'checkin', date: '2026-10-13', weightKg: 71, mood: 5, sleepHours: 8, photoUri: null, updatedAt: 1 });

    expect(await loadCheckin('u1', '2026-10-13')).toMatchObject({ weightKg: 71, mood: 5, pending: true });
  });

  it('still returns the pending edit when the server cannot be reached', async () => {
    maybeSingle.mockRejectedValue(new Error('Network request failed'));
    await enqueue('u1', { kind: 'checkin', date: '2026-10-13', weightKg: 71, mood: 5, sleepHours: 8, photoUri: 'file:///p.jpg', updatedAt: 1 });

    expect(await loadCheckin('u1', '2026-10-13')).toMatchObject({ weightKg: 71, photoUri: 'file:///p.jpg', pending: true });
  });
});
