import { mockStore } from '../../sync/testing/storageMock';
import { clearCache, clearUserCache, readCache, writeCache } from '../../cache/userCache';
import { readCoachCache, writeCoachCache } from '../cache';
import type { CoachExchange } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

const exchange = (id: string, reply = 'a'): CoachExchange => ({ requestId: id, messageId: `m-${id}`, message: 'q', reply, language: 'en', createdAt: null, proposal: null });

describe('coach history cache', () => {
  beforeEach(() => mockStore.clear());

  it('round-trips saved history per account', async () => {
    await writeCoachCache('A', [exchange('r1', 'for A')]);
    await writeCoachCache('B', [exchange('r2', 'for B')]);

    expect((await readCoachCache('A'))?.[0].reply).toBe('for A');
    expect((await readCoachCache('B'))?.[0].reply).toBe('for B');
    expect(await readCoachCache('C')).toBeNull();
  });

  it('ignores a corrupt or wrongly shaped entry', async () => {
    mockStore.set('rise120.cache.A.coach', '{not json');
    expect(await readCoachCache('A')).toBeNull();

    await writeCache('A', 'coach', { not: 'a list' });
    expect(await readCoachCache('A')).toBeNull();

    await writeCache('A', 'coach', [{ requestId: 5 }]);
    expect(await readCoachCache('A')).toBeNull();
  });

  it('is removed with the rest of the account\'s cache when the account is deleted', async () => {
    await writeCoachCache('A', [exchange('r1')]);
    await writeCoachCache('B', [exchange('r2')]);

    await clearUserCache('A');

    expect(await readCoachCache('A')).toBeNull();
    expect(await readCoachCache('B')).not.toBeNull();
  });
});

describe('clearCache', () => {
  beforeEach(() => mockStore.clear());

  it('drops one named entry for one account and nothing else', async () => {
    await writeCache('A', 'plan', { p: 1 });
    await writeCache('A', 'profile', { q: 2 });
    await writeCache('B', 'plan', { r: 3 });

    await clearCache('A', 'plan');

    expect(await readCache('A', 'plan')).toBeNull();
    expect(await readCache('A', 'profile')).toEqual({ q: 2 });
    expect(await readCache('B', 'plan')).toEqual({ r: 3 });
  });
});
