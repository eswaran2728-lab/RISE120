import { mockStore } from '../../sync/testing/storageMock';
import { enqueue } from '../../sync/queue';
import { loadLoggedSets } from '../../plan/planData';
import { nextSetNumber } from '../log';
import { loadSessionSets } from '../session';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../plan/planData', () => ({ loadLoggedSets: jest.fn() }));

const synced = (id: string, exerciseId: string, setNumber: number) => ({ id, exerciseId, setNumber, reps: 10, weightKg: 20 });

describe('loadSessionSets', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('merges synced and pending sets for the date', async () => {
    (loadLoggedSets as jest.Mock).mockResolvedValue([synced('a1', 'A', 1)]);
    await enqueue('u1', { kind: 'workout_set', id: 'a2', date: '2026-10-13', exerciseId: 'A', setNumber: 2, reps: 8, weightKg: 20, updatedAt: 1 });
    await enqueue('u1', { kind: 'workout_set', id: 'old', date: '2026-10-12', exerciseId: 'A', setNumber: 1, reps: 8, weightKg: 20, updatedAt: 1 });

    const sets = await loadSessionSets('u1', '2026-10-13');

    expect(sets.map((s) => [s.id, s.pending])).toEqual([['a1', false], ['a2', true]]);
  });

  it('does not restart set numbers when the server cannot be read (no overwrite of synced sets)', async () => {
    (loadLoggedSets as jest.Mock).mockResolvedValueOnce([synced('a1', 'A', 1), synced('a2', 'A', 2)]);
    await loadSessionSets('u1', '2026-10-13'); // online: remembers the synced sets
    (loadLoggedSets as jest.Mock).mockRejectedValue(new Error('Network request failed'));
    await enqueue('u1', { kind: 'workout_set', id: 'b1', date: '2026-10-13', exerciseId: 'B', setNumber: 1, reps: 8, weightKg: 20, updatedAt: 1 });

    const offline = await loadSessionSets('u1', '2026-10-13');

    expect(nextSetNumber(offline, 'A')).toBe(3);
    expect(nextSetNumber(offline, 'B')).toBe(2);
  });

  it('ignores remembered sets from another day or another account', async () => {
    (loadLoggedSets as jest.Mock).mockResolvedValueOnce([synced('a1', 'A', 1)]);
    await loadSessionSets('u1', '2026-10-12');
    (loadLoggedSets as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    expect(await loadSessionSets('u1', '2026-10-13')).toEqual([]);
    expect(await loadSessionSets('u2', '2026-10-12')).toEqual([]);
  });
});
