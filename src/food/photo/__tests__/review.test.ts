import { mockStore } from '../../../sync/testing/storageMock';
import { listPending } from '../../../sync/queue';
import { recentFoods } from '../../cache';
import { confirmPhotoCandidate, normalizeCandidates, resolveCandidate } from '../review';
import { recipe } from '../../mealPlanner/testing/fixtures';
import { supabase } from '../../../lib/supabase';
import type { Food } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../recipeData', () => ({ loadRecipes: jest.fn() }));
// eslint-disable-next-line import/first
import { loadRecipes } from '../../recipeData';

const FOOD_ID = '3f2b8c1e-1111-4222-8333-444455556666';
const food = (over: Partial<Food> = {}): Food => ({
  id: FOOD_ID, userId: null, name: 'Fixture rice', aliases: {}, servingDesc: '1 bowl', calories: 200, proteinG: 4, carbsG: 44, fatG: 1, source: 'curated', verified: true, region: 'MY', sourceId: 'rice-1', barcode: null, ...over,
});
const raw = (over: Record<string, unknown> = {}) => ({ kind: 'food', id: FOOD_ID, name: 'Fixture rice', uncertainty: 'likely', servings: 1.5, loggable: true, provenance: { source: 'curated', sourceId: 'rice-1', verified: true, reviewed: true }, ...over });

beforeEach(() => {
  mockStore.clear();
  (supabase.from as jest.Mock).mockReset();
  (loadRecipes as jest.Mock).mockReset();
});

describe('normalizeCandidates: what the app keeps of a server answer', () => {
  it('keeps the reference, the name, the uncertainty label, the portion suggestion and the provenance, and nothing else', () => {
    const [candidate] = normalizeCandidates([{ ...raw(), calories: 9999, nutrition: { calories: 1 }, imageUrl: 'x', userId: 'someone' }]);

    expect(candidate).toEqual({ kind: 'food', id: FOOD_ID, name: 'Fixture rice', uncertainty: 'likely', servings: 1.5, loggable: true, provenance: { source: 'curated', sourceId: 'rice-1', verified: true, reviewed: true } });
  });

  it('keeps a recipe with its version', () => {
    const [candidate] = normalizeCandidates([raw({ kind: 'recipe', id: 'bowl', version: 2, provenance: { source: 'recipe', sourceId: 'bowl@2', verified: false, reviewed: true } })]);

    expect(candidate).toMatchObject({ kind: 'recipe', id: 'bowl', version: 2 });
  });

  it('drops anything malformed, caps the list at five and removes duplicates', () => {
    const many = Array.from({ length: 9 }, (_, i) => raw({ id: `00000000-0000-4000-8000-00000000000${i}`, name: `Food ${i}` }));

    const result = normalizeCandidates([...many, many[0], null, 'x', { kind: 'meal', id: FOOD_ID }, raw({ name: '' }), raw({ id: 5 }), raw({ kind: 'recipe', id: 'bowl' })]);

    expect(result).toHaveLength(5);
    expect(new Set(result.map((c) => c.id)).size).toBe(5);
  });

  it('uses only known uncertainty labels, bounded portions and bounded names', () => {
    const [candidate] = normalizeCandidates([raw({ uncertainty: 'certain', servings: 1e9, name: 'x'.repeat(500) })]);

    expect(candidate.uncertainty).toBe('unsure');
    expect(candidate.servings).toBeNull();
    expect(candidate.name.length).toBeLessThanOrEqual(80);
  });

  it('treats a candidate as unloggable unless the server said it is loggable', () => {
    expect(normalizeCandidates([raw({ loggable: undefined })])[0].loggable).toBe(false);
    expect(normalizeCandidates([raw({ loggable: 'yes' })])[0].loggable).toBe(false);
  });

  it('is empty for anything that is not a list', () => {
    expect(normalizeCandidates(undefined)).toEqual([]);
    expect(normalizeCandidates({ candidates: [] })).toEqual([]);
  });
});

describe('resolveCandidate: the record behind a candidate, read under the member\'s own access', () => {
  it('reads a shared sourced food from the catalogue', async () => {
    const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), is: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({ data: { id: FOOD_ID, user_id: null, name: 'Fixture rice', aliases: {}, serving_desc: '1 bowl', calories: 200, protein_g: 4, carbs_g: 44, fat_g: 1, source: 'curated', verified: true, region: 'MY', source_id: 'rice-1', barcode: null }, error: null }) };
    (supabase.from as jest.Mock).mockReturnValue(query);

    const result = await resolveCandidate('A', normalizeCandidates([raw()])[0]);

    expect(result).toMatchObject({ kind: 'ok', selected: { kind: 'food', food: { id: FOOD_ID, source: 'curated', verified: true } } });
    expect(query.is).toHaveBeenCalledWith('user_id', null);
  });

  it('says the record is gone when it is missing, private, or no longer sourced', async () => {
    const gone = (data: unknown) => (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), is: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({ data, error: null }) });
    const candidate = normalizeCandidates([raw()])[0];

    gone(null);
    expect(await resolveCandidate('A', candidate)).toEqual({ kind: 'gone' });
    gone({ id: FOOD_ID, user_id: 'B', name: 'x', aliases: {}, serving_desc: '1', calories: 1, protein_g: 1, carbs_g: 1, fat_g: 1, source: 'custom', verified: false, region: null, source_id: null, barcode: null });
    expect(await resolveCandidate('A', candidate)).toEqual({ kind: 'gone' });
  });

  it('says offline when the catalogue cannot be reached', async () => {
    (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), is: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockRejectedValue(new Error('Network request failed')) });

    expect(await resolveCandidate('A', normalizeCandidates([raw()])[0])).toEqual({ kind: 'offline' });
  });

  it('finds a published shared recipe at the candidate\'s version, from the phone\'s cache when offline', async () => {
    (loadRecipes as jest.Mock).mockResolvedValue([recipe('bowl', { version: 1 }), recipe('bowl', { version: 2 })]);

    const result = await resolveCandidate('A', normalizeCandidates([raw({ kind: 'recipe', id: 'bowl', version: 2 })])[0]);

    expect(result).toMatchObject({ kind: 'ok', selected: { kind: 'recipe', recipe: { id: 'bowl', version: 2 } } });
  });

  it('says gone for a recipe that is not in the member\'s published list (a private or unpublished one never is)', async () => {
    (loadRecipes as jest.Mock).mockResolvedValue([recipe('other')]);

    expect(await resolveCandidate('A', normalizeCandidates([raw({ kind: 'recipe', id: 'bowl', version: 1 })])[0])).toEqual({ kind: 'gone' });
  });
});

describe('confirmPhotoCandidate: the only way a photo candidate becomes a meal', () => {
  const LOG = '9a2b8c1e-1111-4222-8333-444455556666';

  it('queues a food log with the stable id, the food snapshot (source and verified label kept) and the corrected quantity', async () => {
    const result = await confirmPhotoCandidate('A', '2026-10-20', { kind: 'food', food: food() }, 2.5, 'lunch', LOG);

    expect(result).toEqual({ kind: 'logged', logId: LOG });
    const [op] = await listPending('A');
    expect(op).toMatchObject({ kind: 'food_log', id: LOG, foodId: FOOD_ID, quantity: 2.5, mealType: 'lunch', deleted: false });
    expect((op as { food: Food }).food).toMatchObject({ source: 'curated', verified: true, sourceId: 'rice-1' });
  });

  it('is one log however many times Save is repeated, with the latest quantity', async () => {
    await confirmPhotoCandidate('A', '2026-10-20', { kind: 'food', food: food() }, 1, 'lunch', LOG);
    await confirmPhotoCandidate('A', '2026-10-20', { kind: 'food', food: food() }, 2, 'lunch', LOG);

    const ops = await listPending('A');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ quantity: 2 });
  });

  it('refuses a bad quantity and queues nothing', async () => {
    for (const q of [0, -1, NaN, Infinity, 101]) {
      expect(await confirmPhotoCandidate('A', '2026-10-20', { kind: 'food', food: food() }, q, 'lunch', LOG)).toEqual({ kind: 'invalid_quantity' });
    }
    expect(await listPending('A')).toEqual([]);
  });

  it('refuses a food that is not a shared sourced catalogue food: private, custom, Open Food Facts, or with a missing value', async () => {
    for (const bad of [food({ userId: 'A' }), food({ source: 'custom' }), food({ source: 'openfoodfacts' }), food({ calories: Number.NaN })]) {
      expect(await confirmPhotoCandidate('A', '2026-10-20', { kind: 'food', food: bad }, 1, 'lunch', LOG)).toEqual({ kind: 'not_eligible' });
    }
    expect(await listPending('A')).toEqual([]);
  });

  it('logs a published recipe through its private food: the food is queued before the log, with the recipe version kept', async () => {
    const result = await confirmPhotoCandidate('A', '2026-10-20', { kind: 'recipe', recipe: recipe('bowl') }, 1.5, 'dinner', LOG);

    expect(result).toEqual({ kind: 'logged', logId: LOG });
    const ops = await listPending('A');
    expect(ops.map((o) => o.kind)).toEqual(['recipe_food', 'food_log']);
    expect(ops[0]).toMatchObject({ food: { source: 'recipe', sourceId: 'bowl@1', verified: false, userId: 'A' } });
    expect(ops[1]).toMatchObject({ id: LOG, quantity: 1.5, mealType: 'dinner' });
    expect(await recentFoods('A')).toEqual([expect.objectContaining({ source: 'recipe', verified: false })]);
  });

  it('leaves a recipe with any unknown core nutrient unloggable, and queues nothing', async () => {
    const unknown = recipe('bowl', { nutrition: { ...recipe('bowl').nutrition!, perServing: { ...recipe('bowl').nutrition!.perServing, proteinG: null } } });

    expect(await confirmPhotoCandidate('A', '2026-10-20', { kind: 'recipe', recipe: unknown }, 1, 'dinner', LOG)).toEqual({ kind: 'nutrition_unknown' });
    expect(await listPending('A')).toEqual([]);
  });

  it('refuses a recipe that is not shared and published', async () => {
    expect(await confirmPhotoCandidate('A', '2026-10-20', { kind: 'recipe', recipe: recipe('bowl', { status: 'private', userId: 'A' }) }, 1, 'dinner', LOG)).toEqual({ kind: 'not_eligible' });
    expect(await listPending('A')).toEqual([]);
  });

  it('keeps accounts apart', async () => {
    await confirmPhotoCandidate('A', '2026-10-20', { kind: 'food', food: food() }, 1, 'lunch', LOG);

    expect(await listPending('B')).toEqual([]);
  });
});
