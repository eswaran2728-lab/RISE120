import { mockStore } from '../../sync/testing/storageMock';
import { clearUserCache } from '../../cache/userCache';
import { supabase } from '../../lib/supabase';
import { loadDishes } from '../eatingOutData';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

// SYNTHETIC rows only.
const L = (t: string) => ({ en: t, ms: `${t} ms`, ta: `${t} ta` });
const reviewer = { name: 'Fixture', role: 'Fixture role', reviewedOn: '2000-01-01' };
const provenance = { name: 'Fixture', url: null, recordId: null, version: '1', accessedOn: '2000-01-02', licenceEvidence: 'Fixture' };
const row = (id: string, version: number, over: Record<string, unknown> = {}) => ({
  id, version, status: 'published', region: 'MY', name: L(id), aliases: {}, tips: [L('tip')], calories_min: 400, calories_max: 700, serving_note: L('One plate'), provenance, reviewer, ...over,
});
const answer = (data: unknown, error: unknown = null) => (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue({ data, error }) });

beforeEach(() => {
  mockStore.clear();
  (supabase.from as jest.Mock).mockReset();
});

describe('loadDishes', () => {
  it('keeps the newest published version of each dish', async () => {
    answer([row('a', 1), row('a', 2), row('b', 1)]);

    expect((await loadDishes('A')).map((d) => [d.id, d.version]).sort()).toEqual([['a', 2], ['b', 1]]);
  });

  it('never shows an unpublished dish or one that breaks the rules, even if the server sent it', async () => {
    answer([row('draft', 1, { status: 'draft' }), row('no-tips', 1, { tips: [] }), row('precise', 1, { calories_min: 500, calories_max: 500 }), row('ok', 1)]);

    expect((await loadDishes('A')).map((d) => d.id)).toEqual(['ok']);
  });

  it('remembers what it read for offline, per account, and is empty when nothing was ever read', async () => {
    answer([row('a', 1)]);
    await loadDishes('A');
    answer(null, { message: 'offline' });

    expect((await loadDishes('A')).map((d) => d.id)).toEqual(['a']);
    expect(await loadDishes('B')).toEqual([]);
    await clearUserCache('A');
    expect(await loadDishes('A')).toEqual([]);
  });
});
