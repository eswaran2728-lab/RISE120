import { mockStore } from '../../sync/testing/storageMock';
import { clearUserCache } from '../../cache/userCache';
import { supabase } from '../../lib/supabase';
import { loadExercises } from '../catalogueData';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const row = (id: string, version: number, over: Record<string, unknown> = {}) => ({
  id, version, pattern: 'squat', equipment: 'none', name: L(id), cues: [L('one'), L('two')], regressions: [], alternatives: [], media: null, reviewer: { name: 'A', role: 'Coach', reviewedOn: '2026-10-10' }, status: 'published', ...over,
});
const answer = (data: unknown, error: unknown = null) => {
  const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data, error }) };
  (supabase.from as jest.Mock).mockReturnValue(query);
  return query;
};

beforeEach(() => {
  mockStore.clear();
  (supabase.from as jest.Mock).mockReset();
});

describe('loadExercises', () => {
  it('reads only published exercises and keeps the newest version of each', async () => {
    const query = answer([row('squat', 1), row('squat', 3, { equipment: 'home' }), row('lunge', 2)]);

    const exercises = await loadExercises('A');

    expect(query.eq).toHaveBeenCalledWith('status', 'published');
    expect(exercises.map((e) => [e.id, e.version]).sort()).toEqual([['lunge', 2], ['squat', 3]]);
    expect(exercises.find((e) => e.id === 'squat')!.equipment).toBe('home');
  });

  it('remembers what it read, so cues and names are still there with no signal', async () => {
    answer([row('squat', 1)]);
    await loadExercises('A');

    answer(null, { message: 'Network request failed' });

    expect((await loadExercises('A')).map((e) => e.id)).toEqual(['squat']);
  });

  it('gives an empty list, not an error, when nothing was ever read and the network is down', async () => {
    answer(null, { message: 'Network request failed' });

    expect(await loadExercises('A')).toEqual([]);
  });

  it('keeps accounts apart and is removed with the account', async () => {
    answer([row('squat', 1)]);
    await loadExercises('A');
    answer(null, { message: 'offline' });

    expect(await loadExercises('B')).toEqual([]);
    await clearUserCache('A');
    expect(await loadExercises('A')).toEqual([]);
  });

  it('skips rows that are not the shape it expects instead of showing broken content', async () => {
    answer([row('squat', 1), { id: 'broken', version: 1 }, row('lunge', 1, { cues: 'not a list' })]);

    expect((await loadExercises('A')).map((e) => e.id)).toEqual(['squat']);
  });
});
