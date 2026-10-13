import { mockStore } from '../../sync/testing/storageMock';
import { supabase } from '../../lib/supabase';
import { recentFoods } from '../cache';
import { saveUsdaFood, searchUsda, UsdaPreview } from '../usda';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() } } }));

const preview: UsdaPreview = {
  source: 'usda',
  sourceId: '170000',
  name: 'Rice, white, cooked',
  servingDesc: '100 g',
  calories: 130,
  proteinG: 2.7,
  carbsG: 28.2,
  fatG: 0.3,
  verified: false,
};

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'food-1', user_id: 'u1', name: preview.name, aliases: {}, serving_desc: '100 g', calories: 130, protein_g: 2.7,
  carbs_g: 28.2, fat_g: 0.3, source: 'usda', verified: false, region: null, source_id: '170000', barcode: null, ...extra,
});

describe('searchUsda', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls the search-foods function with the query and page', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: { foods: [preview], skipped: 0, hasMore: true, page: 0 }, error: null });

    const result = await searchUsda('rice', 0);

    expect(supabase.functions.invoke).toHaveBeenCalledWith('search-foods', { method: 'POST', body: { query: 'rice', page: 0 } });
    expect(result).toEqual({ foods: [preview], hasMore: true, skipped: 0 });
  });

  it.each([
    [429, 'rate_limited'],
    [503, 'not_configured'],
    [502, 'unavailable'],
    [504, 'unavailable'],
    [400, 'unavailable'],
  ])('reports HTTP %i as %s', async (status, code) => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: null, error: { message: 'x', context: { status } } });

    await expect(searchUsda('rice', 0)).rejects.toMatchObject({ code });
  });

  it('reports a network failure as unavailable', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: null, error: { message: 'Failed to send a request' } });

    await expect(searchUsda('rice', 0)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('treats a malformed response as unavailable', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: { nope: true }, error: null });

    await expect(searchUsda('rice', 0)).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('saveUsdaFood', () => {
  const maybeSingle = jest.fn();
  const single = jest.fn();
  const insert = jest.fn();
  const eqCalls: [string, unknown][] = [];

  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
    eqCalls.length = 0;
    const select = { eq: jest.fn() };
    select.eq.mockImplementation((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return select.eq.mock.calls.length % 3 === 0 ? { maybeSingle } : select;
    });
    insert.mockReturnValue({ select: () => ({ single }) });
    (supabase.from as jest.Mock).mockReturnValue({ select: () => select, insert });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    single.mockResolvedValue({ data: row(), error: null });
  });

  it('stores the preview as an own, unverified food with a stable source id', async () => {
    const food = await saveUsdaFood('u1', preview);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        name: 'Rice, white, cooked',
        serving_desc: '100 g',
        calories: 130,
        protein_g: 2.7,
        carbs_g: 28.2,
        fat_g: 0.3,
        source: 'usda',
        source_id: '170000',
        verified: false,
        region: null,
      })
    );
    expect(food).toMatchObject({ id: 'food-1', source: 'usda', verified: false, sourceId: '170000' });
  });

  it('reuses the existing food for the same source id instead of inserting again', async () => {
    maybeSingle.mockResolvedValue({ data: row({ id: 'existing' }), error: null });

    const food = await saveUsdaFood('u1', preview);

    expect(food.id).toBe('existing');
    expect(insert).not.toHaveBeenCalled();
  });

  it('looks up by this user, the source and the source id', async () => {
    await saveUsdaFood('u1', preview);

    expect(eqCalls).toEqual([['user_id', 'u1'], ['source', 'usda'], ['source_id', '170000']]);
  });

  it('falls back to the existing row when a concurrent save wins the unique constraint', async () => {
    single.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });
    maybeSingle.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: row({ id: 'winner' }), error: null });

    expect((await saveUsdaFood('u1', preview)).id).toBe('winner');
  });

  it('remembers the saved food for offline search', async () => {
    await saveUsdaFood('u1', preview);

    expect((await recentFoods('u1')).map((f) => f.id)).toEqual(['food-1']);
  });

  it('refuses a preview with missing or inconsistent nutrition and never inserts zeros', async () => {
    await expect(saveUsdaFood('u1', { ...preview, calories: Number.NaN })).rejects.toThrow();
    await expect(saveUsdaFood('u1', { ...preview, calories: 2500 })).rejects.toThrow();
    await expect(saveUsdaFood('u1', { ...preview, name: '  ' })).rejects.toThrow();

    expect(insert).not.toHaveBeenCalled();
  });

  it('throws the database error when saving fails', async () => {
    single.mockResolvedValue({ data: null, error: { code: '42501', message: 'Network request failed' } });

    await expect(saveUsdaFood('u1', preview)).rejects.toThrow('Network request failed');
  });
});
