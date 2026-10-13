import { mockStore } from '../../sync/testing/storageMock';
import { clearUserCache } from '../../cache/userCache';
import { recentFoods, rememberFoods } from '../cache';
import type { Food } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

const food = (id: string, extra: Partial<Food> = {}): Food => ({
  id,
  userId: null,
  name: `Food ${id}`,
  aliases: {},
  servingDesc: '1 serving',
  calories: 100,
  proteinG: 5,
  carbsG: 15,
  fatG: 2,
  source: 'usda',
  verified: false,
  region: null,
  sourceId: null,
  barcode: null,
  ...extra,
});

describe('recent foods cache', () => {
  beforeEach(() => mockStore.clear());

  it('is empty until something is remembered', async () => {
    expect(await recentFoods('u1')).toEqual([]);
  });

  it('returns the most recently remembered food first, with its source and verified label', async () => {
    await rememberFoods('u1', [food('a', { source: 'curated', verified: true, region: 'MY' })]);
    await rememberFoods('u1', [food('b')]);

    const recent = await recentFoods('u1');

    expect(recent.map((f) => f.id)).toEqual(['b', 'a']);
    expect(recent[1]).toMatchObject({ source: 'curated', verified: true, region: 'MY' });
  });

  it('lists a food once and moves it to the front when logged again', async () => {
    await rememberFoods('u1', [food('a'), food('b')]);
    await rememberFoods('u1', [food('a', { name: 'Renamed' })]);

    const recent = await recentFoods('u1');

    expect(recent.map((f) => f.id)).toEqual(['a', 'b']);
    expect(recent[0].name).toBe('Renamed');
  });

  it('keeps only the most recent 50', async () => {
    for (let i = 0; i < 60; i++) await rememberFoods('u1', [food(`f${i}`)]);

    const recent = await recentFoods('u1');

    expect(recent).toHaveLength(50);
    expect(recent[0].id).toBe('f59');
    expect(recent.some((f) => f.id === 'f0')).toBe(false);
  });

  it('is scoped to the account', async () => {
    await rememberFoods('u1', [food('a')]);

    expect(await recentFoods('u2')).toEqual([]);
  });

  it('is cleared with the rest of the account cache on deletion', async () => {
    await rememberFoods('u1', [food('a')]);
    await rememberFoods('u2', [food('b')]);

    await clearUserCache('u1');

    expect(await recentFoods('u1')).toEqual([]);
    expect((await recentFoods('u2')).map((f) => f.id)).toEqual(['b']);
  });

  it('treats a corrupt entry as empty', async () => {
    mockStore.set('rise120.cache.u1.recentFoods', '{oops');

    expect(await recentFoods('u1')).toEqual([]);
  });
});
