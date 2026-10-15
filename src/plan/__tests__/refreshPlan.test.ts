import { mockStore } from '../../sync/testing/storageMock';
import { supabase } from '../../lib/supabase';
import { readCache, writeCache } from '../../cache/userCache';
import { loadPlanBundle, refreshPlanBundle } from '../planData';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const planRow = { id: 'p1', start_date: '2026-10-16', status: 'active' };
const dayRows = [{ day_number: 5, workout: { kind: 'rest' }, calorie_target: 2750, protein_target_g: 130 }];
const exerciseRows = [{ id: 'e1', name: 'Plank', muscle_group: 'core', equipment: 'gym', instructions: 'Hold.' }];

function serve(options: { plan?: unknown; fail?: boolean } = {}) {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    const result = (data: unknown) => ({ data, error: options.fail ? { message: 'offline' } : null });
    const q: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'order']) q[name] = () => q;
    q.maybeSingle = async () => result(table === 'plans' ? (options.plan === undefined ? planRow : options.plan) : null);
    (q as { then: (r: (v: unknown) => void) => void }).then = (resolve) => resolve(result(table === 'plan_days' ? dayRows : exerciseRows));
    return q;
  });
}

describe('refreshPlanBundle', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('reads the plan from the server and replaces the cached copy', async () => {
    await writeCache('A', 'plan', { stale: true });
    serve();

    const bundle = await refreshPlanBundle('A');

    expect(bundle?.days[0]).toMatchObject({ dayNumber: 5, calorieTarget: 2750 });
    expect((await readCache<{ days: unknown[] }>('A', 'plan'))?.days).toHaveLength(1);
  });

  it('throws when the server cannot be read and never falls back to the cache, so old values are not passed off as current', async () => {
    await writeCache('A', 'plan', { plan: planRow, days: [], exercises: [] });
    serve({ fail: true });

    await expect(refreshPlanBundle('A')).rejects.toThrow();
    // The ordinary loader would have quietly returned the cache here; the refresh must not.
    await expect(loadPlanBundle('A')).resolves.not.toBeNull();
  });

  it('answers null when the account has no plan, without caching anything', async () => {
    serve({ plan: null });

    expect(await refreshPlanBundle('A')).toBeNull();
    expect(await readCache('A', 'plan')).toBeNull();
  });
});
