import { mockStore } from '../../sync/testing/storageMock';
import { enqueue } from '../../sync/queue';
import { supabase } from '../../lib/supabase';
import { loadCheckinDates } from '../load';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const eq = jest.fn();

describe('loadCheckinDates', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
    eq.mockResolvedValue({ data: [{ checkin_date: '2026-10-12' }, { checkin_date: '2026-10-11' }], error: null });
    (supabase.from as jest.Mock).mockReturnValue({ select: () => ({ eq }) });
  });

  it('returns the server check-in dates', async () => {
    expect((await loadCheckinDates('u1')).sort()).toEqual(['2026-10-11', '2026-10-12']);
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('adds not-yet-synced check-ins once, without duplicating dates', async () => {
    await enqueue('u1', { kind: 'checkin', date: '2026-10-13', weightKg: 70, mood: 3, sleepHours: 7, photoUri: null, updatedAt: 1 });
    await enqueue('u1', { kind: 'checkin', date: '2026-10-12', weightKg: 70, mood: 3, sleepHours: 7, photoUri: null, updatedAt: 1 });

    expect((await loadCheckinDates('u1')).sort()).toEqual(['2026-10-11', '2026-10-12', '2026-10-13']);
  });

  it('falls back to pending dates when the server cannot be reached', async () => {
    eq.mockRejectedValue(new Error('Network request failed'));
    await enqueue('u1', { kind: 'checkin', date: '2026-10-13', weightKg: 70, mood: 3, sleepHours: 7, photoUri: null, updatedAt: 1 });

    expect(await loadCheckinDates('u1')).toEqual(['2026-10-13']);
  });

  it('does not include another account pending check-ins', async () => {
    await enqueue('u2', { kind: 'checkin', date: '2026-10-13', weightKg: 70, mood: 3, sleepHours: 7, photoUri: null, updatedAt: 1 });

    expect((await loadCheckinDates('u1')).sort()).toEqual(['2026-10-11', '2026-10-12']);
  });
});

describe('loadCheckinDates offline streak', () => {
  const pendingCheckin = (date: string) => ({ kind: 'checkin' as const, date, weightKg: 70, mood: 3, sleepHours: 7, photoUri: null, updatedAt: 1 });

  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
    (supabase.from as jest.Mock).mockReturnValue({ select: () => ({ eq }) });
  });

  it('keeps previously synced dates when the app starts offline', async () => {
    eq.mockResolvedValueOnce({ data: [{ checkin_date: '2026-10-11' }, { checkin_date: '2026-10-12' }], error: null });
    await loadCheckinDates('u1'); // online: remembers the synced dates
    eq.mockRejectedValue(new Error('Network request failed'));

    expect((await loadCheckinDates('u1')).sort()).toEqual(['2026-10-11', '2026-10-12']);
  });

  it('merges pending check-ins with remembered dates once, without duplicates', async () => {
    eq.mockResolvedValueOnce({ data: [{ checkin_date: '2026-10-11' }, { checkin_date: '2026-10-12' }], error: null });
    await loadCheckinDates('u1');
    eq.mockRejectedValue(new Error('Network request failed'));
    await enqueue('u1', pendingCheckin('2026-10-12'));
    await enqueue('u1', pendingCheckin('2026-10-13'));

    expect((await loadCheckinDates('u1')).sort()).toEqual(['2026-10-11', '2026-10-12', '2026-10-13']);
  });

  it('also falls back to the remembered dates when the server returns an error', async () => {
    eq.mockResolvedValueOnce({ data: [{ checkin_date: '2026-10-11' }], error: null });
    await loadCheckinDates('u1');
    eq.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });

    expect(await loadCheckinDates('u1')).toEqual(['2026-10-11']);
  });

  it('replaces the remembered dates with the latest server answer', async () => {
    eq.mockResolvedValueOnce({ data: [{ checkin_date: '2026-10-11' }], error: null });
    await loadCheckinDates('u1');
    eq.mockResolvedValueOnce({ data: [{ checkin_date: '2026-10-14' }], error: null });
    await loadCheckinDates('u1');
    eq.mockRejectedValue(new Error('Network request failed'));

    expect(await loadCheckinDates('u1')).toEqual(['2026-10-14']);
  });

  it('never shows another account remembered dates', async () => {
    eq.mockResolvedValueOnce({ data: [{ checkin_date: '2026-10-11' }], error: null });
    await loadCheckinDates('u1');
    eq.mockRejectedValue(new Error('Network request failed'));

    expect(await loadCheckinDates('u2')).toEqual([]);
  });
});
