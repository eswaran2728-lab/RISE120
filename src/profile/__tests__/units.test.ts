import { mockStore } from '../../sync/testing/storageMock';
import { supabase } from '../../lib/supabase';
import { cacheUnits, loadProfileCache, loadUnits, saveProfileCache } from '../cache';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const maybeSingle = jest.fn();

describe('profile cache and loadUnits', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
    (supabase.from as jest.Mock).mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) });
  });

  it('returns the server units and remembers them', async () => {
    maybeSingle.mockResolvedValue({ data: { units: 'imperial' }, error: null });

    expect(await loadUnits('u1')).toBe('imperial');
    maybeSingle.mockRejectedValue(new Error('Network request failed'));
    expect(await loadUnits('u1')).toBe('imperial');
  });

  it('uses the remembered units offline, including after a change back to metric', async () => {
    maybeSingle.mockResolvedValue({ data: { units: 'imperial' }, error: null });
    await loadUnits('u1');
    maybeSingle.mockResolvedValue({ data: { units: 'metric' }, error: null });
    await loadUnits('u1');
    maybeSingle.mockRejectedValue(new Error('Network request failed'));

    expect(await loadUnits('u1')).toBe('metric');
  });

  it('keeps an imperial user on imperial while offline', async () => {
    await cacheUnits('u1', 'imperial');
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });

    expect(await loadUnits('u1')).toBe('imperial');
  });

  it('defaults to metric when nothing is known', async () => {
    maybeSingle.mockRejectedValue(new Error('Network request failed'));

    expect(await loadUnits('u1')).toBe('metric');
  });

  it('cacheUnits remembers units without touching the profile flags', async () => {
    await saveProfileCache('u1', { onboarded: true, needsPlanInputs: false, language: 'ms' });

    await cacheUnits('u1', 'imperial');
    maybeSingle.mockRejectedValue(new Error('Network request failed'));

    expect(await loadUnits('u1')).toBe('imperial');
    expect(await loadProfileCache('u1')).toEqual({ onboarded: true, needsPlanInputs: false, language: 'ms' });
  });

  it('scopes the cache to the account', async () => {
    await saveProfileCache('u1', { onboarded: true, needsPlanInputs: false, language: null });
    await cacheUnits('u1', 'imperial');

    expect(await loadProfileCache('u2')).toBeNull();
    maybeSingle.mockRejectedValue(new Error('Network request failed'));
    expect(await loadUnits('u2')).toBe('metric');
  });
});
