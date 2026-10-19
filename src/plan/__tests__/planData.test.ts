import { mockStore } from '../../sync/testing/storageMock';
import { supabase } from '../../lib/supabase';
import { loadPlanBundle, mapExercise, mapLoggedSet, mapPlan, mapPlanDay } from '../planData';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

describe('plan row mappers', () => {
  it('maps a plan row', () => {
    expect(mapPlan({ id: 'p1', start_date: '2026-10-13', status: 'active' })).toEqual({
      id: 'p1',
      startDate: '2026-10-13',
      status: 'active',
      cycleNumber: 1,
    });
  });

  it('maps a plan day, keeping a missing calorie target as null', () => {
    expect(
      mapPlanDay({ day_number: 3, workout: { kind: 'rest' }, calorie_target: null, protein_target_g: 125 })
    ).toEqual({ dayNumber: 3, workout: { kind: 'rest' }, calorieTarget: null, proteinTargetG: 125 });
  });

  it('treats an unknown workout shape as a rest day instead of crashing', () => {
    expect(mapPlanDay({ day_number: 1, workout: null, calorie_target: 2000, protein_target_g: 100 }).workout).toEqual({ kind: 'rest' });
    expect(mapPlanDay({ day_number: 1, workout: { nope: 1 }, calorie_target: 2000, protein_target_g: 100 }).workout).toEqual({ kind: 'rest' });
  });

  it('maps an exercise row', () => {
    expect(
      mapExercise({ id: 'e1', name: 'Plank', muscle_group: 'core', equipment: 'gym', instructions: 'Hold.' })
    ).toEqual({ id: 'e1', name: 'Plank', muscleGroup: 'core', equipment: 'gym', instructions: 'Hold.' });
  });

  it('maps a logged set, converting numeric strings from the database', () => {
    expect(mapLoggedSet({ id: 's1', exercise_id: 'e1', set_number: 2, reps: 8, weight_kg: '22.5' })).toEqual({
      id: 's1',
      exerciseId: 'e1',
      setNumber: 2,
      reps: 8,
      weightKg: 22.5,
      sessionId: null,
    });
  });

  it('keeps which started session a set belongs to, so guided and regular sets can be told apart', () => {
    expect(mapLoggedSet({ id: 's1', exercise_id: 'e1', set_number: 1, reps: 8, weight_kg: 20, session_id: 'sess-1' })).toMatchObject({ sessionId: 'sess-1' });
  });
});

describe('loadPlanBundle offline cache', () => {
  const planRow = { id: 'p1', start_date: '2026-10-13', status: 'active' };
  const dayRows = [{ day_number: 1, workout: { kind: 'rest' }, calorie_target: null, protein_target_g: 100 }];
  const exerciseRows = [{ id: 'e1', name: 'Plank', muscle_group: 'core', equipment: 'gym', instructions: 'Hold.' }];

  function mockServer(options: { plan?: unknown; fail?: 'plan' | 'throw' } = {}) {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (options.fail === 'throw') throw new Error('Network request failed');
      if (table === 'plans') {
        return {
          // The app asks for the active plan: eq(user), eq(status), order(cycle), limit(1), then one row.
          select: () => {
            const q: Record<string, unknown> = {};
            for (const name of ['eq', 'order', 'limit']) q[name] = () => q;
            q.maybeSingle = async () =>
              options.fail === 'plan'
                ? { data: null, error: { message: 'Network request failed' } }
                : { data: options.plan === undefined ? planRow : options.plan, error: null };
            return q;
          },
        };
      }
      if (table === 'plan_days') return { select: () => ({ eq: () => ({ order: async () => ({ data: dayRows, error: null }) }) }) };
      return { select: async () => ({ data: exerciseRows, error: null }) };
    });
  }

  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('returns the bundle from the server', async () => {
    mockServer();

    expect(await loadPlanBundle('u1')).toMatchObject({ plan: { id: 'p1', startDate: '2026-10-13' } });
  });

  it('falls back to the last good bundle when the server cannot be reached', async () => {
    mockServer();
    const online = await loadPlanBundle('u1');
    mockServer({ fail: 'plan' });

    expect(await loadPlanBundle('u1')).toEqual(online);
  });

  it('falls back to the cache when the request throws', async () => {
    mockServer();
    const online = await loadPlanBundle('u1');
    mockServer({ fail: 'throw' });

    expect(await loadPlanBundle('u1')).toEqual(online);
  });

  it('still fails when offline with nothing cached', async () => {
    mockServer({ fail: 'plan' });

    await expect(loadPlanBundle('u1')).rejects.toThrow();
  });

  it('does not use another account cached plan', async () => {
    mockServer();
    await loadPlanBundle('u2');
    mockServer({ fail: 'plan' });

    await expect(loadPlanBundle('u1')).rejects.toThrow();
  });

  it('returns null, not a stale plan, when the server says there is no plan', async () => {
    mockServer();
    await loadPlanBundle('u1');
    mockServer({ plan: null });

    expect(await loadPlanBundle('u1')).toBeNull();
  });
});
