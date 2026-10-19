import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import FoodSearchScreen from '../../../app/food-search';
import { t } from '../../i18n';
import { mockStore } from '../../sync/testing/storageMock';
import { listPending } from '../../sync/queue';
import { flushPending } from '../../sync/flush';
import { rememberFoods } from '../cache';
import { loadFavourites, toggleFavourite } from '../favourites';
import { findFoods } from '../search';
import type { Food } from '../types';

jest.setTimeout(30000);

let mockUser = 'A';
const mockRouter = { back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => true };
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ meal: 'lunch' }), useRouter: () => mockRouter }));
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: { user: { id: mockUser } } }) }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock('../../lib/useDebouncedValue', () => ({ useDebouncedValue: (value: string) => value }));
jest.mock('../../sync/flush', () => ({ flushPending: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../sync/supabaseTransport', () => ({ supabaseTransport: {} }));
jest.mock('../search', () => ({ findFoods: jest.fn() }));
jest.mock('../usda', () => ({ ...jest.requireActual('../usda'), searchUsda: jest.fn(), saveUsdaFood: jest.fn() }));

// SYNTHETIC foods only.
const food = (id: string, over: Partial<Food> = {}): Food => ({
  id, userId: null, name: `Food ${id}`, aliases: {}, servingDesc: '1 plate', calories: 500, proteinG: 20, carbsG: 60, fatG: 15, source: 'curated', verified: true, region: 'MY', sourceId: `src-${id}`, barcode: null, ...over,
});

const textsOf = (tree: ReactTestRenderer): string[] => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') out.push(node);
    else if (node && typeof node === 'object') ((node as { children?: unknown[] | null }).children ?? []).forEach(walk);
  };
  walk(tree.toJSON());
  return out;
};
const shows = (tree: ReactTestRenderer, text: string) => textsOf(tree).some((s) => s.includes(text));
const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string' && (typeof n.props.onPress === 'function' || typeof n.props.onChangeText === 'function')).pop();
const press = (tree: ReactTestRenderer, id: string) =>
  act(async () => {
    await byId(tree, id)!.props.onPress();
  });
async function mount() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<FoodSearchScreen />);
  });
  return tree;
}

beforeEach(() => {
  mockStore.clear();
  mockUser = 'A';
  jest.clearAllMocks();
  (findFoods as jest.Mock).mockRejectedValue(new Error('no network'));
});

describe('favourites on the food search screen', () => {
  it('shows favourites before recent foods with no network, each with its source and verified label', async () => {
    await toggleFavourite('A', food('rice'));
    await toggleFavourite('A', food('usda', { source: 'usda', verified: false }));
    await rememberFoods('A', [food('recent-one')]);

    const tree = await mount();

    expect(shows(tree, t('food.favourites.title'))).toBe(true);
    expect(byId(tree, 'favourite-rice')).toBeDefined();
    expect(byId(tree, 'favourite-usda')).toBeDefined();
    expect(shows(tree, t('food.verified'))).toBe(true); // the curated one
    expect(shows(tree, t('food.sources.usda'))).toBe(true); // the unverified one keeps its source
    expect(findFoods).not.toHaveBeenCalled();
  });

  it('shows another accounts nothing: favourites are private to the signed-in account', async () => {
    await toggleFavourite('B', food('secret'));

    const tree = await mount();

    expect(byId(tree, 'favourite-secret')).toBeUndefined();
    expect(shows(tree, t('food.favourites.empty'))).toBe(true); // this account has none
  });

  it('starts a favourite at the servings last used, and lets the member change them before saving', async () => {
    await toggleFavourite('A', food('rice'));
    const { rememberServings } = jest.requireActual('../favourites');
    await rememberServings('A', 'rice', 1.5);
    const tree = await mount();

    await press(tree, 'favourite-rice');

    expect(byId(tree, 'food-entry-quantity')!.props.value).toBe('1.5');
    await act(async () => {
      byId(tree, 'food-entry-quantity')!.props.onChangeText('2');
    });
    await press(tree, 'food-entry-submit');
    const [op] = await listPending('A');
    expect(op).toMatchObject({ kind: 'food_log', quantity: 2, mealType: 'lunch' });
    expect((op as { food: Food }).food).toMatchObject({ source: 'curated', verified: true, sourceId: 'src-rice' });
  });

  it('makes one log however many times Save is pressed, and replays it once to the server', async () => {
    await toggleFavourite('A', food('rice'));
    const tree = await mount();
    await press(tree, 'favourite-rice');

    await act(async () => {
      void byId(tree, 'food-entry-submit')!.props.onPress();
      void byId(tree, 'food-entry-submit')!.props.onPress();
    });
    await press(tree, 'food-entry-submit');

    const ops = await listPending('A');
    expect(ops).toHaveLength(1);
    expect(flushPending).toHaveBeenCalledWith('A', expect.anything());
  });

  it('remembers the servings for next time once a favourite is logged', async () => {
    await toggleFavourite('A', food('rice'));
    const tree = await mount();
    await press(tree, 'favourite-rice');
    await act(async () => {
      byId(tree, 'food-entry-quantity')!.props.onChangeText('2.5');
    });

    await press(tree, 'food-entry-submit');

    expect((await loadFavourites('A'))[0].lastServings).toBe(2.5);
  });

  it('lets a recent food be starred and unstarred', async () => {
    await rememberFoods('A', [food('recent-one')]);
    const tree = await mount();

    await press(tree, 'favourite-toggle-recent-one');
    expect((await loadFavourites('A')).map((f) => f.food.id)).toEqual(['recent-one']);

    await press(tree, 'favourite-toggle-recent-one');
    expect(await loadFavourites('A')).toEqual([]);
  });

  it('says so when the catalogue now holds different values than the favourite was saved with, and still shows what was saved', async () => {
    await toggleFavourite('A', food('rice'));
    await rememberFoods('A', [food('rice', { calories: 450 })]); // the latest version seen

    const tree = await mount();

    expect(shows(tree, t('food.favourites.changed'))).toBe(true);
    expect(shows(tree, '500')).toBe(true); // the saved version is what the favourite shows
  });

  it('does not let a favourite of Open Food Facts exist: scanned products stay a preview', async () => {
    await rememberFoods('A', [food('scanned', { source: 'openfoodfacts', verified: false })]);
    const tree = await mount();

    await press(tree, 'favourite-toggle-scanned');

    expect(await loadFavourites('A')).toEqual([]);
  });

  it('keeps the usual search and the manual way to add food when there are no favourites', async () => {
    const tree = await mount();

    expect(shows(tree, t('food.search.addOwn'))).toBe(true);
    expect(shows(tree, t('food.favourites.empty'))).toBe(true);
  });
});
