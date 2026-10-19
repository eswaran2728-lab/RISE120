import { mockStore } from '../../sync/testing/storageMock';
import { clearUserCache } from '../../cache/userCache';
import { supabase } from '../../lib/supabase';
import { loadRecipes, mapRecipeRow } from '../recipeData';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

// SYNTHETIC rows only.
const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'Fixture', role: 'Fixture role', reviewedOn: '2000-01-01' };
const row = (id: string, version: number, over: Record<string, unknown> = {}) => ({
  id, version, user_id: null, status: 'published', verified: false, region: 'MY', name: L(id), aliases: {}, servings: 2,
  ingredients: [{ ref: { source: 'fixture', sourceId: 'rice' }, name: 'rice', amount: 200, unit: 'g', tags: [] }],
  preparation: [L('Cook.')], prep_minutes: 5, cook_minutes: 10, cooking: ['stovetop'], diet_labels: [], free_from: [],
  nutrition: { perServing: { calories: 300, proteinG: 10, carbsG: 45, fatG: 7, fibreG: null, sugarG: null, sodiumMg: null }, provenance: { name: 'Fixture', url: null, recordId: null, version: '1', accessedOn: '2000-01-01', licenceEvidence: 'Fixture' } },
  price: null, reviewer, ...over,
});
const answer = (data: unknown, error: unknown = null) => {
  const query = { select: jest.fn().mockResolvedValue({ data, error }) };
  (supabase.from as jest.Mock).mockReturnValue(query);
  return query;
};

beforeEach(() => {
  mockStore.clear();
  (supabase.from as jest.Mock).mockReset();
});

describe('mapRecipeRow', () => {
  it('maps a database row, tagging nutrition as per serving, and keeps unknown values null', () => {
    const recipe = mapRecipeRow(row('a', 1))!;

    expect(recipe).toMatchObject({ id: 'a', version: 1, userId: null, servings: 2, prepMinutes: 5, cookMinutes: 10, price: null });
    expect(recipe.nutrition!.perServing).toMatchObject({ basis: 'per_serving', calories: 300, fibreG: null, sugarG: null });
    expect(recipe.nutrition!.provenance.version).toBe('1');
  });

  it('keeps a missing price and missing minutes as unknown, not zero', () => {
    const recipe = mapRecipeRow(row('a', 1, { price: null, prep_minutes: null, cook_minutes: null }))!;

    expect(recipe.price).toBeNull();
    expect([recipe.prepMinutes, recipe.cookMinutes]).toEqual([null, null]);
  });

  it.each([
    ['not an object', null],
    ['no ingredients array', row('a', 1, { ingredients: 'x' })],
    ['name not localised', row('a', 1, { name: 'x' })],
    ['yield missing', row('a', 1, { servings: null })],
    ['unknown status', row('a', 1, { status: 'live' })],
  ])('gives null for a row with %s', (_name, bad) => {
    expect(mapRecipeRow(bad as never)).toBeNull();
  });
});

describe('loadRecipes', () => {
  it('reads recipes and keeps the newest version of each', async () => {
    answer([row('a', 1), row('a', 3), row('b', 2)]);

    const recipes = await loadRecipes('u1');

    expect(recipes.map((r) => [r.id, r.version]).sort()).toEqual([['a', 3], ['b', 2]]);
  });

  it('drops a recipe whose claims its ingredients cannot support, rather than showing it', async () => {
    answer([row('good', 1), row('claims-too-much', 1, { diet_labels: ['vegetarian'], ingredients: [{ ref: { source: 'fixture', sourceId: 'chicken' }, name: 'chicken', amount: 100, unit: 'g', tags: ['meat'] }] })]);

    expect((await loadRecipes('u1')).map((r) => r.id)).toEqual(['good']);
  });

  it('never shows an unpublished shared recipe or another accounts private recipe, even if the server sent it', async () => {
    answer([
      row('draft', 1, { status: 'draft' }),
      row('mine', 1, { user_id: 'u1', status: 'private', reviewer: null }),
      row('theirs', 1, { user_id: 'u2', status: 'private', reviewer: null }),
      row('shared', 1),
    ]);

    expect((await loadRecipes('u1')).map((r) => r.id).sort()).toEqual(['mine', 'shared']);
  });

  it('remembers what it read, so recipes are there with no signal, and keeps accounts apart', async () => {
    answer([row('a', 1)]);
    await loadRecipes('u1');
    answer(null, { message: 'Network request failed' });

    expect((await loadRecipes('u1')).map((r) => r.id)).toEqual(['a']);
    expect(await loadRecipes('u2')).toEqual([]);
    await clearUserCache('u1');
    expect(await loadRecipes('u1')).toEqual([]);
  });

  it('applies the same rules to what it remembers: another accounts private recipe in the cache is not shown', async () => {
    answer([row('theirs', 1, { user_id: 'u2', status: 'private', reviewer: null })]);
    await loadRecipes('u2');
    mockStore.set('rise120.cache.u1.recipes', mockStore.get('rise120.cache.u2.recipes')!);
    answer(null, { message: 'offline' });

    expect(await loadRecipes('u1')).toEqual([]);
  });

  it('gives an empty list, not an error, when nothing was ever read and the network is down', async () => {
    answer(null, { message: 'offline' });

    expect(await loadRecipes('u1')).toEqual([]);
  });
});
