import { mockStore } from '../../sync/testing/storageMock';
import { ensurePlan } from '../ensurePlan';
import { hasSeenPreview, markPreviewSeen } from '../previewSeen';
import type { PlanBundle } from '../planData';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() } } }));

const bundle: PlanBundle = { plan: { id: 'p1', startDate: '2026-10-13', status: 'active' }, days: [], exercises: [] };

describe('ensurePlan', () => {
  it('returns an existing plan without generating one', async () => {
    const generate = jest.fn();

    const result = await ensurePlan({ load: async () => bundle, generate, today: () => '2026-10-13' });

    expect(result).toEqual({ bundle, created: false });
    expect(generate).not.toHaveBeenCalled();
  });

  it('generates with the local date when there is no plan, then loads it', async () => {
    const load = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(bundle);
    const generate = jest.fn().mockResolvedValue(undefined);

    const result = await ensurePlan({ load, generate, today: () => '2026-10-13' });

    expect(generate).toHaveBeenCalledWith('2026-10-13');
    expect(result).toEqual({ bundle, created: true });
  });

  it('fails when generation fails, so the screen can offer a retry', async () => {
    const generate = jest.fn().mockRejectedValue(new Error('Network request failed'));

    await expect(ensurePlan({ load: async () => null, generate, today: () => '2026-10-13' })).rejects.toThrow('Network request failed');
  });

  it('fails when the plan still cannot be loaded after generating', async () => {
    await expect(ensurePlan({ load: async () => null, generate: async () => undefined, today: () => '2026-10-13' })).rejects.toThrow();
  });
});

describe('preview seen flag', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('is false until marked, and scoped to the account', async () => {
    expect(await hasSeenPreview('u1')).toBe(false);

    await markPreviewSeen('u1');

    expect(await hasSeenPreview('u1')).toBe(true);
    expect(await hasSeenPreview('u2')).toBe(false);
  });
});
