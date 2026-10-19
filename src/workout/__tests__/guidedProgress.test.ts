import { mockStore } from '../../sync/testing/storageMock';
import { clearUserCache } from '../../cache/userCache';
import { supabase } from '../../lib/supabase';
import { loadGuidedProgress } from '../guidedProgress';
import { loadSessionExercises } from '../sessionActions';
import { loadExerciseLinks } from '../availability';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../sessionActions', () => ({ loadSessionExercises: jest.fn() }));
jest.mock('../availability', () => ({ loadExerciseLinks: jest.fn() }));

const table = (rows: unknown, error: unknown = null) =>
  (supabase.from as jest.Mock).mockImplementation(() => {
    const answer = { data: rows, error };
    const query: Record<string, jest.Mock> = {};
    query.select = jest.fn(() => query);
    query.eq = jest.fn(() => query);
    (query as unknown as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(answer);
    return query;
  });
const entry = (exerciseId: string, sets: number, kept = false) => ({ exerciseId, sets, reps: 10, name: { en: exerciseId, ms: exerciseId, ta: exerciseId }, pattern: 'squat', equipment: 'none', ...(kept ? { kept: true } : {}) });
const links = new Map([['squat', 'u-squat'], ['lunge', 'u-lunge'], ['stepup', 'u-stepup']]);

beforeEach(() => {
  mockStore.clear();
  (supabase.from as jest.Mock).mockReset();
  (loadSessionExercises as jest.Mock).mockReset();
  (loadExerciseLinks as jest.Mock).mockReset();
  table([{ id: 'sess-1', status: 'active' }]);
  (loadSessionExercises as jest.Mock).mockResolvedValue({ revision: 0, status: 'active', exercises: [entry('squat', 3), entry('lunge', 2)] });
  (loadExerciseLinks as jest.Mock).mockResolvedValue(links);
});

describe('loadGuidedProgress', () => {
  it('reads the started session for this plan and day, with its planned sets per logged-set exercise', async () => {
    expect(await loadGuidedProgress('A', 'plan-1', 5)).toEqual({ sessionId: 'sess-1', status: 'active', planned: [{ exerciseId: 'u-squat', sets: 3 }, { exerciseId: 'u-lunge', sets: 2 }] });
  });

  it('is null when no session was started for that plan and day', async () => {
    table([]);

    expect(await loadGuidedProgress('A', 'plan-1', 5)).toBeNull();
  });

  it('prefers the active session, and reports a finished one as completed', async () => {
    table([{ id: 'old', status: 'completed' }, { id: 'sess-2', status: 'active' }]);
    expect((await loadGuidedProgress('A', 'plan-1', 5))?.sessionId).toBe('sess-2');

    table([{ id: 'old', status: 'completed' }]);
    (loadSessionExercises as jest.Mock).mockResolvedValue({ revision: 0, status: 'completed', exercises: [entry('squat', 3)] });
    expect(await loadGuidedProgress('A', 'plan-1', 5)).toMatchObject({ sessionId: 'old', status: 'completed' });
  });

  it('counts the sets left after a swap under the replacement, and the sets done before it under the original', async () => {
    (loadSessionExercises as jest.Mock).mockResolvedValue({ revision: 1, status: 'active', exercises: [entry('squat', 2, true), entry('stepup', 1), entry('lunge', 2)] });

    const progress = await loadGuidedProgress('A', 'plan-1', 5);

    expect(progress?.planned).toEqual([{ exerciseId: 'u-squat', sets: 2 }, { exerciseId: 'u-stepup', sets: 1 }, { exerciseId: 'u-lunge', sets: 2 }]);
  });

  it('asks only about the plan and day it was given', async () => {
    await loadGuidedProgress('A', 'plan-1', 5);

    const query = (supabase.from as jest.Mock).mock.results[0].value;
    expect(query.eq).toHaveBeenCalledWith('plan_id', 'plan-1');
    expect(query.eq).toHaveBeenCalledWith('day_number', 5);
  });

  it('remembers what it read, so a launch with no signal still knows the session', async () => {
    await loadGuidedProgress('A', 'plan-1', 5);
    table(null, { message: 'Network request failed' });

    expect(await loadGuidedProgress('A', 'plan-1', 5)).toEqual({ sessionId: 'sess-1', status: 'active', planned: [{ exerciseId: 'u-squat', sets: 3 }, { exerciseId: 'u-lunge', sets: 2 }] });
  });

  it('also falls back to the remembered session when only the exercise list cannot be read', async () => {
    await loadGuidedProgress('A', 'plan-1', 5);
    (loadSessionExercises as jest.Mock).mockResolvedValue(null);

    expect((await loadGuidedProgress('A', 'plan-1', 5))?.sessionId).toBe('sess-1');
  });

  it('never uses a remembered session for another plan or day (a different cycle or journey day)', async () => {
    await loadGuidedProgress('A', 'plan-1', 5);
    table(null, { message: 'offline' });

    expect(await loadGuidedProgress('A', 'plan-1', 6)).toBeNull();
    expect(await loadGuidedProgress('A', 'plan-2', 5)).toBeNull();
  });

  it('never uses another accounts remembered session, and forgets it with the account', async () => {
    await loadGuidedProgress('A', 'plan-1', 5);
    table(null, { message: 'offline' });

    expect(await loadGuidedProgress('B', 'plan-1', 5)).toBeNull();
    await clearUserCache('A');
    expect(await loadGuidedProgress('A', 'plan-1', 5)).toBeNull();
  });

  it('forgets a remembered session the server says does not exist for that day', async () => {
    await loadGuidedProgress('A', 'plan-1', 5);
    table([]);
    await loadGuidedProgress('A', 'plan-1', 5);
    table(null, { message: 'offline' });

    expect(await loadGuidedProgress('A', 'plan-1', 5)).toBeNull();
  });

  it('leaves out an exercise that has no link, since its sets cannot be logged', async () => {
    (loadExerciseLinks as jest.Mock).mockResolvedValue(new Map([['squat', 'u-squat']]));

    expect((await loadGuidedProgress('A', 'plan-1', 5))?.planned).toEqual([{ exerciseId: 'u-squat', sets: 3 }]);
  });
});
