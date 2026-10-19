import { mockStore } from '../../sync/testing/storageMock';
import { clearUserCache } from '../../cache/userCache';
import { compareToCurrent, isFavourite, loadFavourites, rememberServings, removeFavourite, toggleFavourite } from '../favourites';
import type { Food } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

// SYNTHETIC foods only.
const food = (id: string, over: Partial<Food> = {}): Food => ({
  id, userId: null, name: id, aliases: {}, servingDesc: '1 plate', calories: 500, proteinG: 20, carbsG: 60, fatG: 15, source: 'curated', verified: true, region: 'MY', sourceId: `src-${id}`, barcode: null, ...over,
});

beforeEach(() => mockStore.clear());

describe('favourites are private to the account and survive a restart', () => {
  it('starts empty and remembers a favourite with its source and verified label', async () => {
    expect(await loadFavourites('A')).toEqual([]);

    await toggleFavourite('A', food('rice'));

    const [fav] = await loadFavourites('A');
    expect(fav.food).toMatchObject({ id: 'rice', source: 'curated', verified: true, sourceId: 'src-rice' });
    expect(await isFavourite('A', 'rice')).toBe(true);
  });

  it('is read again from storage after a restart, with no network involved', async () => {
    await toggleFavourite('A', food('rice'));
    const stored = mockStore.get('rise120.cache.A.favourites')!;
    mockStore.clear();
    mockStore.set('rise120.cache.A.favourites', stored); // the phone restarted: only storage is left

    expect((await loadFavourites('A')).map((f) => f.food.id)).toEqual(['rice']);
  });

  it('keeps accounts apart and removes everything with the account', async () => {
    await toggleFavourite('A', food('rice'));

    expect(await loadFavourites('B')).toEqual([]);
    expect(await isFavourite('B', 'rice')).toBe(false);
    await clearUserCache('A');
    expect(await loadFavourites('A')).toEqual([]);
  });

  it('toggles off again, and lists the newest first', async () => {
    await toggleFavourite('A', food('a'));
    await toggleFavourite('A', food('b'));
    expect((await loadFavourites('A')).map((f) => f.food.id)).toEqual(['b', 'a']);

    expect(await toggleFavourite('A', food('b'))).toBe(false);
    expect((await loadFavourites('A')).map((f) => f.food.id)).toEqual(['a']);
    expect(await removeFavourite('A', 'a')).toBeUndefined();
    expect(await loadFavourites('A')).toEqual([]);
  });

  it('never keeps Open Food Facts products: they are preview only and are not stored', async () => {
    expect(await toggleFavourite('A', food('off', { source: 'openfoodfacts', verified: false }))).toBe(false);
    expect(await loadFavourites('A')).toEqual([]);
  });

  it('shows an unverified source as unverified, never promoted', async () => {
    await toggleFavourite('A', food('usda-rice', { source: 'usda', verified: false }));

    expect((await loadFavourites('A'))[0].food).toMatchObject({ source: 'usda', verified: false });
  });

  it('ignores a damaged stored list and a list holding something that is not a food', async () => {
    mockStore.set('rise120.cache.A.favourites', '{ not json');
    expect(await loadFavourites('A')).toEqual([]);

    mockStore.set('rise120.cache.A.favourites', JSON.stringify([{ nope: 1 }, { food: { id: 'x' }, savedAt: 1, lastServings: 1 }]));
    expect(await loadFavourites('A')).toEqual([]);
  });

  it('keeps at most a hundred, dropping the oldest', async () => {
    for (let i = 0; i < 102; i++) await toggleFavourite('A', food(`f${i}`));

    const list = await loadFavourites('A');
    expect(list).toHaveLength(100);
    expect(list[0].food.id).toBe('f101');
  });
});

describe('portions on a favourite', () => {
  it('remembers the servings last used, so the next log starts there and can still be edited', async () => {
    await toggleFavourite('A', food('rice'));
    expect((await loadFavourites('A'))[0].lastServings).toBe(1);

    await rememberServings('A', 'rice', 1.5);

    expect((await loadFavourites('A'))[0].lastServings).toBe(1.5);
  });

  it('refuses servings that make no sense and leaves the last good value', async () => {
    await toggleFavourite('A', food('rice'));
    await rememberServings('A', 'rice', 2);

    for (const bad of [0, -1, NaN, 101]) await rememberServings('A', 'rice', bad);

    expect((await loadFavourites('A'))[0].lastServings).toBe(2);
  });

  it('does nothing for a food that is not a favourite', async () => {
    await rememberServings('A', 'ghost', 2);

    expect(await loadFavourites('A')).toEqual([]);
  });
});

describe('a favourite keeps the version it was saved with', () => {
  it('stays identifiable and unchanged when the catalogue later changes the food', async () => {
    await toggleFavourite('A', food('rice'));
    const saved = (await loadFavourites('A'))[0];

    // the catalogue now has different values for the same food: saving again does not rewrite the old snapshot
    await toggleFavourite('A', food('rice', { calories: 450 }));
    await toggleFavourite('A', food('rice', { calories: 450 }));

    const again = (await loadFavourites('A'))[0];
    expect(again.food.calories).toBe(450); // a deliberate fresh save takes the new values
    expect(saved.food.calories).toBe(500);
  });

  it('says whether the catalogue still matches what was saved', async () => {
    await toggleFavourite('A', food('rice'));
    const [fav] = await loadFavourites('A');

    expect(compareToCurrent(fav, food('rice'))).toBe('same');
    expect(compareToCurrent(fav, food('rice', { calories: 450 }))).toBe('changed');
    expect(compareToCurrent(fav, food('rice', { servingDesc: '1 bowl' }))).toBe('changed');
    expect(compareToCurrent(fav, food('rice', { verified: false }))).toBe('changed');
    expect(compareToCurrent(fav, food('rice', { sourceId: 'src-rice-v2' }))).toBe('changed');
    expect(compareToCurrent(fav, null)).toBe('unavailable');
  });

  it('refreshing keeps the old snapshot until the member chooses the new one', async () => {
    await toggleFavourite('A', food('rice'));
    const [fav] = await loadFavourites('A');

    expect(fav.food.calories).toBe(500);
    expect(fav.savedAt).toBeGreaterThan(0);
  });
});
