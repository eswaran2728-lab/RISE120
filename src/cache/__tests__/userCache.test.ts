import { mockStore } from '../../sync/testing/storageMock';
import { clearUserCache, readCache, writeCache } from '../userCache';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

describe('userCache', () => {
  beforeEach(() => mockStore.clear());

  it('returns null when nothing is cached', async () => {
    expect(await readCache('u1', 'plan')).toBeNull();
  });

  it('round-trips a value per user and name', async () => {
    await writeCache('u1', 'plan', { a: 1 });
    await writeCache('u1', 'profile', { b: 2 });

    expect(await readCache('u1', 'plan')).toEqual({ a: 1 });
    expect(await readCache('u1', 'profile')).toEqual({ b: 2 });
    expect(await readCache('u2', 'plan')).toBeNull();
  });

  it('treats a corrupt entry as empty', async () => {
    mockStore.set('rise120.cache.u1.plan', '{not json');

    expect(await readCache('u1', 'plan')).toBeNull();
  });

  it('clears every cached name for one user only', async () => {
    await writeCache('u1', 'plan', 1);
    await writeCache('u1', 'profile', 2);
    await writeCache('u1', 'sets', 3);
    await writeCache('u1', 'units', 'imperial');
    await writeCache('u2', 'plan', 4);

    await clearUserCache('u1');

    expect(await readCache('u1', 'plan')).toBeNull();
    expect(await readCache('u1', 'profile')).toBeNull();
    expect(await readCache('u1', 'sets')).toBeNull();
    expect(await readCache('u1', 'units')).toBeNull();
    expect(await readCache('u2', 'plan')).toBe(4);
  });
});
