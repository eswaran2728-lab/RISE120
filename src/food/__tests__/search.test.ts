import { mockStore } from '../../sync/testing/storageMock';
import { supabase } from '../../lib/supabase';
import { rememberFoods } from '../cache';
import { findFoods, normalizeText, rankFoods, searchStoredFoods } from '../search';
import type { Food } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

let counter = 0;
const food = (overrides: Partial<Food>): Food => ({
  id: `f${++counter}`,
  userId: null,
  name: 'Food',
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
  ...overrides,
});

describe('normalizeText', () => {
  it('lowercases, trims, collapses spaces and strips Latin diacritics', () => {
    expect(normalizeText('  Crème   BRÛLÉE ')).toBe('creme brulee');
  });

  it('keeps Tamil text intact (vowel signs are not diacritics to strip)', () => {
    expect(normalizeText('தோசை')).toBe('தோசை');
  });
});

describe('rankFoods', () => {
  const nasiLemakMy = food({ name: 'Nasi lemak', verified: true, region: 'MY', source: 'curated' });
  const nasiUsda = food({ name: 'Rice with coconut milk, nasi style', source: 'usda' });
  const nasiCustom = food({ name: 'Nasi lemak (my own)', userId: 'u1', source: 'custom' });

  it('puts a matching verified Malaysian food ahead of every other match', () => {
    const ranked = rankFoods('nasi', [nasiUsda, nasiCustom, nasiLemakMy]);

    expect(ranked[0].id).toBe(nasiLemakMy.id);
  });

  it('retains all other matches: ranking changes order, not eligibility', () => {
    const ranked = rankFoods('nasi', [nasiUsda, nasiCustom, nasiLemakMy]);

    expect(ranked.map((f) => f.id).sort()).toEqual([nasiUsda.id, nasiCustom.id, nasiLemakMy.id].sort());
  });

  it('excludes foods that do not match, even verified Malaysian ones', () => {
    const roti = food({ name: 'Roti canai', verified: true, region: 'MY' });

    expect(rankFoods('nasi', [roti, nasiUsda]).map((f) => f.id)).toEqual([nasiUsda.id]);
  });

  it('does not treat an unverified or non-MY food as Malaysian-first', () => {
    const unverifiedMy = food({ name: 'Nasi goreng', verified: false, region: 'MY' });
    const verifiedOther = food({ name: 'Nasi bowl', verified: true, region: 'SG' });
    const verifiedMy = food({ name: 'Nasi kandar', verified: true, region: 'MY' });

    const ranked = rankFoods('nasi', [unverifiedMy, verifiedOther, verifiedMy]);

    expect(ranked[0].id).toBe(verifiedMy.id);
  });

  it('matches reviewed Malay and Tamil aliases and English aliases', () => {
    const noodles = food({ name: 'Fried noodles', aliases: { en: ['stir-fried noodles'], ms: ['mi goreng'], ta: ['நூடுல்ஸ் வறுவல்'] } });
    const other = food({ name: 'Bread' });

    expect(rankFoods('mi goreng', [other, noodles]).map((f) => f.id)).toEqual([noodles.id]);
    expect(rankFoods('நூடுல்ஸ்', [other, noodles]).map((f) => f.id)).toEqual([noodles.id]);
    expect(rankFoods('stir-fried', [other, noodles]).map((f) => f.id)).toEqual([noodles.id]);
  });

  it('handles case and Latin diacritics in both query and food names', () => {
    const cafe = food({ name: 'Café au lait' });

    expect(rankFoods('CAFE', [cafe]).map((f) => f.id)).toEqual([cafe.id]);
    expect(rankFoods('café', [food({ name: 'Cafe latte' })])).toHaveLength(1);
  });

  it('requires every word of the query to match', () => {
    const a = food({ name: 'Chicken rice' });
    const b = food({ name: 'Chicken soup' });

    expect(rankFoods('chicken rice', [a, b]).map((f) => f.id)).toEqual([a.id]);
  });

  it('orders by relevance within a tier: exact, then starts-with, then contains', () => {
    const contains = food({ name: 'Spicy rice dish' });
    const prefix = food({ name: 'Rice pudding' });
    const exact = food({ name: 'Rice' });

    expect(rankFoods('rice', [contains, prefix, exact]).map((f) => f.id)).toEqual([exact.id, prefix.id, contains.id]);
  });

  it('keeps the input order for an empty query except for the Malaysian-first rule', () => {
    const a = food({ name: 'A' });
    const my = food({ name: 'B', verified: true, region: 'MY' });

    expect(rankFoods('  ', [a, my]).map((f) => f.id)).toEqual([my.id, a.id]);
  });
});

describe('searchStoredFoods', () => {
  const rows = [
    { id: 'r1', user_id: null, name: 'Nasi lemak', aliases: { ms: ['nasi lemak biasa'] }, serving_desc: '1 plate', calories: '644', protein_g: '15.5', carbs_g: '80', fat_g: '28', source: 'curated', verified: true, region: 'MY', source_id: null, barcode: null },
  ];
  const range = jest.fn();
  const chain: Record<string, jest.Mock> = {};

  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
    range.mockResolvedValue({ data: rows, error: null });
    for (const name of ['select', 'ilike', 'order']) chain[name] = jest.fn().mockReturnValue(chain);
    chain.range = range;
    (supabase.from as jest.Mock).mockReturnValue(chain);
  });

  it('queries foods under row-level security with one filter per word, ordered verified first', async () => {
    const result = await searchStoredFoods('u1', 'Nasi  Lemak');

    expect(supabase.from).toHaveBeenCalledWith('foods');
    expect(chain.ilike).toHaveBeenCalledWith('search_text', '%nasi%');
    expect(chain.ilike).toHaveBeenCalledWith('search_text', '%lemak%');
    expect(chain.order).toHaveBeenCalledWith('verified', { ascending: false });
    expect(result.foods[0]).toMatchObject({ id: 'r1', calories: 644, proteinG: 15.5, verified: true, region: 'MY' });
  });

  it('escapes LIKE wildcards in the query', async () => {
    await searchStoredFoods('u1', '100%_milk');

    expect(chain.ilike).toHaveBeenCalledWith('search_text', '%100\\%\\_milk%');
  });

  it('pages in bounded steps and reports when there may be more', async () => {
    range.mockResolvedValue({ data: Array.from({ length: 20 }, (_, i) => ({ ...rows[0], id: `p${i}` })), error: null });

    const first = await searchStoredFoods('u1', 'nasi', 0);
    const second = await searchStoredFoods('u1', 'nasi', 1);

    expect(range).toHaveBeenNthCalledWith(1, 0, 19);
    expect(range).toHaveBeenNthCalledWith(2, 20, 39);
    expect(first.hasMore).toBe(true);
    expect(second.foods).toHaveLength(20);
  });

  it('reports no more results after a short page', async () => {
    expect((await searchStoredFoods('u1', 'nasi')).hasMore).toBe(false);
  });

  it('throws when the server query fails', async () => {
    range.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });

    await expect(searchStoredFoods('u1', 'nasi')).rejects.toThrow('Network request failed');
  });
});

describe('findFoods fallback', () => {
  const range = jest.fn();
  const chain: Record<string, jest.Mock> = {};
  const logged = food({ name: 'Nasi lemak', verified: true, region: 'MY', source: 'curated' });
  const loggedOther = food({ name: 'Apple', source: 'usda' });

  beforeEach(async () => {
    mockStore.clear();
    jest.clearAllMocks();
    for (const name of ['select', 'ilike', 'order']) chain[name] = jest.fn().mockReturnValue(chain);
    chain.range = range;
    (supabase.from as jest.Mock).mockReturnValue(chain);
  });

  it('returns recent foods that match when the remote search fails, keeping source and verified labels', async () => {
    await rememberFoods('u1', [logged, loggedOther]);
    range.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });

    const result = await findFoods('u1', 'nasi');

    expect(result.offline).toBe(true);
    expect(result.foods).toEqual([logged]);
    expect(result.foods[0]).toMatchObject({ source: 'curated', verified: true });
  });

  it('returns all recent foods for an empty query when offline', async () => {
    await rememberFoods('u1', [logged, loggedOther]);
    range.mockRejectedValue(new Error('Network request failed'));

    expect((await findFoods('u1', '')).foods.map((f) => f.id).sort()).toEqual([logged.id, loggedOther.id].sort());
  });

  it('does not use another account recent foods', async () => {
    await rememberFoods('u2', [logged]);
    range.mockRejectedValue(new Error('Network request failed'));

    expect((await findFoods('u1', 'nasi')).foods).toEqual([]);
  });

  it('uses the server results when the search works', async () => {
    range.mockResolvedValue({ data: [], error: null });

    expect(await findFoods('u1', 'nasi')).toEqual({ foods: [], hasMore: false, offline: false });
  });
});
