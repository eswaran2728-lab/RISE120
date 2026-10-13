import { handleSearchFoods } from '../functions/_shared/food/handler';
import { parseUsdaSearch } from '../functions/_shared/food/usda';
import { isEnergyConsistent as serverConsistent } from '../functions/_shared/food/consistency';
import { isEnergyConsistent as clientConsistent } from '../../src/food/validation';
import { callFunction, createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(60000);

const nutrient = (nutrientId: number, value: number, unitName = 'G') => ({ nutrientId, nutrientName: `n${nutrientId}`, unitName, value });
const per100g = (kcal: number, p: number, c: number, f: number) => [
  nutrient(1008, kcal, 'KCAL'),
  nutrient(1003, p),
  nutrient(1005, c),
  nutrient(1004, f),
];

const foundation = (overrides: Record<string, unknown> = {}) => ({
  fdcId: 170000,
  description: 'Rice, white, cooked',
  dataType: 'SR Legacy',
  foodNutrients: per100g(130, 2.7, 28.2, 0.3),
  ...overrides,
});

describe('parseUsdaSearch', () => {
  it('normalizes a per-100 g food into an unverified usda preview with a visible serving', () => {
    const { foods, skipped } = parseUsdaSearch({ foods: [foundation()], currentPage: 1, totalPages: 1 });

    expect(skipped).toBe(0);
    expect(foods).toEqual([
      {
        source: 'usda',
        sourceId: '170000',
        name: 'Rice, white, cooked',
        servingDesc: '100 g',
        calories: 130,
        proteinG: 2.7,
        carbsG: 28.2,
        fatG: 0.3,
        verified: false,
      },
    ]);
  });

  it('scales a branded food to its serving size in grams and shows the household serving', () => {
    const branded = foundation({
      fdcId: 2,
      description: 'Oat biscuits',
      dataType: 'Branded',
      brandOwner: 'Acme',
      servingSize: 30,
      servingSizeUnit: 'g',
      householdServingFullText: '2 biscuits',
      foodNutrients: per100g(450, 7, 70, 15),
    });

    const [food] = parseUsdaSearch({ foods: [branded] }).foods;

    expect(food).toMatchObject({ servingDesc: '2 biscuits (30 g)', calories: 135, proteinG: 2.1, carbsG: 21, fatG: 4.5, brand: 'Acme' });
  });

  it('uses an Atwater energy value when plain energy is absent', () => {
    const food = foundation({ foodNutrients: [nutrient(2047, 130, 'KCAL'), nutrient(1003, 2.7), nutrient(1005, 28.2), nutrient(1004, 0.3)] });

    expect(parseUsdaSearch({ foods: [food] }).foods[0].calories).toBe(130);
  });

  it.each([
    ['missing calories', { foodNutrients: [nutrient(1003, 2.7), nutrient(1005, 28.2), nutrient(1004, 0.3)] }],
    ['missing protein', { foodNutrients: [nutrient(1008, 130, 'KCAL'), nutrient(1005, 28.2), nutrient(1004, 0.3)] }],
    ['missing carbohydrate', { foodNutrients: [nutrient(1008, 130, 'KCAL'), nutrient(1003, 2.7), nutrient(1004, 0.3)] }],
    ['missing fat', { foodNutrients: [nutrient(1008, 130, 'KCAL'), nutrient(1003, 2.7), nutrient(1005, 28.2)] }],
    ['energy in kJ', { foodNutrients: [nutrient(1008, 544, 'KJ'), nutrient(1003, 2.7), nutrient(1005, 28.2), nutrient(1004, 0.3)] }],
    ['a macro not in grams', { foodNutrients: [nutrient(1008, 130, 'KCAL'), nutrient(1003, 2700, 'MG'), nutrient(1005, 28.2), nutrient(1004, 0.3)] }],
    ['a non-numeric value', { foodNutrients: [nutrient(1008, 130, 'KCAL'), { ...nutrient(1003, 0), value: 'abc' }, nutrient(1005, 28.2), nutrient(1004, 0.3)] }],
    ['a negative value', { foodNutrients: per100g(130, -1, 28.2, 0.3) }],
    ['energy far from its macros (bad or mixed-unit data)', { foodNutrients: per100g(2500, 2.7, 28.2, 0.3) }],
    ['a branded serving that is not in grams', { dataType: 'Branded', servingSize: 240, servingSizeUnit: 'ml' }],
    ['a branded serving with a zero size', { dataType: 'Branded', servingSize: 0, servingSizeUnit: 'g' }],
    ['no id', { fdcId: undefined }],
    ['no name', { description: '  ' }],
  ])('skips a record with %s instead of writing zero', (_label, overrides) => {
    const { foods, skipped } = parseUsdaSearch({ foods: [foundation(overrides)] });

    expect(foods).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('keeps a true zero nutrient when it is reported', () => {
    const water = foundation({ description: 'Water', foodNutrients: per100g(0, 0, 0, 0) });

    expect(parseUsdaSearch({ foods: [water] }).foods[0]).toMatchObject({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it('drops a duplicate FDC id and tolerates junk entries', () => {
    const result = parseUsdaSearch({ foods: [foundation(), foundation({ description: 'Duplicate' }), null, 'x', 5] });

    expect(result.foods).toHaveLength(1);
    expect(result.foods[0].name).toBe('Rice, white, cooked');
    expect(result.skipped).toBe(4);
  });

  it('reports whether more pages exist', () => {
    expect(parseUsdaSearch({ foods: [], currentPage: 1, totalPages: 3 }).hasMore).toBe(true);
    expect(parseUsdaSearch({ foods: [], currentPage: 3, totalPages: 3 }).hasMore).toBe(false);
  });

  it('returns nothing for a malformed upstream response', () => {
    expect(parseUsdaSearch(null)).toEqual({ foods: [], skipped: 0, hasMore: false });
    expect(parseUsdaSearch({ foods: 'nope' })).toEqual({ foods: [], skipped: 0, hasMore: false });
  });
});

describe('handleSearchFoods', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });
  // apiKey: a string, or null for "no key configured" (undefined would pick the default).
  const deps = (fetchFn: jest.Mock, apiKey: string | null = 'secret-key') => ({ apiKey: apiKey ?? undefined, fetchFn: fetchFn as unknown as typeof fetch });

  it('calls USDA with the key in a header (not the URL) and a bounded page size', async () => {
    const fetchFn = jest.fn().mockResolvedValue(ok({ foods: [foundation()], currentPage: 1, totalPages: 1 }));

    const result = await handleSearchFoods({ query: ' rice ', page: 0 }, deps(fetchFn));

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ foods: [{ sourceId: '170000' }], hasMore: false });
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain('query=rice');
    expect(String(url)).toContain('pageSize=20');
    expect(String(url)).toContain('pageNumber=1');
    expect(String(url)).not.toContain('secret-key');
    expect(init.headers['X-Api-Key']).toBe('secret-key');
  });

  it('never returns the API key in any response', async () => {
    const fetchFn = jest.fn().mockResolvedValue(ok({ foods: [foundation()] }));
    const responses = [
      await handleSearchFoods({ query: 'rice', page: 0 }, deps(fetchFn)),
      await handleSearchFoods({ query: '', page: 0 }, deps(fetchFn)),
      await handleSearchFoods({ query: 'rice', page: 0 }, deps(jest.fn().mockRejectedValue(new Error('boom secret-key')))),
      await handleSearchFoods({ query: 'rice', page: 0 }, deps(jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'secret-key' }), headers: { get: () => null } }))),
    ];

    for (const response of responses) expect(JSON.stringify(response.body)).not.toContain('secret-key');
  });

  it.each([
    ['empty query', { query: '', page: 0 }],
    ['blank query', { query: '   ', page: 0 }],
    ['one character', { query: 'a', page: 0 }],
    ['oversized query', { query: 'x'.repeat(81), page: 0 }],
    ['non-string query', { query: 5, page: 0 }],
    ['negative page', { query: 'rice', page: -1 }],
    ['fractional page', { query: 'rice', page: 1.5 }],
    ['page too large', { query: 'rice', page: 21 }],
    ['non-numeric page', { query: 'rice', page: 'two' }],
  ])('rejects %s with 400 and does not call USDA', async (_label, input) => {
    const fetchFn = jest.fn();

    const result = await handleSearchFoods(input, deps(fetchFn));

    expect(result.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('defaults a missing page to the first page', async () => {
    const fetchFn = jest.fn().mockResolvedValue(ok({ foods: [] }));

    expect((await handleSearchFoods({ query: 'rice' }, deps(fetchFn))).status).toBe(200);
    expect(String(fetchFn.mock.calls[0][0])).toContain('pageNumber=1');
  });

  it('is unavailable (503) when no API key is configured, without calling USDA', async () => {
    const fetchFn = jest.fn();

    expect((await handleSearchFoods({ query: 'rice', page: 0 }, deps(fetchFn, null))).status).toBe(503);
    expect((await handleSearchFoods({ query: 'rice', page: 0 }, deps(fetchFn, ''))).status).toBe(503);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('passes a USDA 429 on as rate_limited', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}), headers: { get: () => '30' } });

    expect(await handleSearchFoods({ query: 'rice', page: 0 }, deps(fetchFn))).toEqual({
      status: 429,
      body: { error: 'rate_limited', retryAfter: 30 },
    });
  });

  it('maps a timeout to 504 and other upstream failures to 502', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });

    expect((await handleSearchFoods({ query: 'rice', page: 0 }, deps(jest.fn().mockRejectedValue(abort)))).status).toBe(504);
    expect((await handleSearchFoods({ query: 'rice', page: 0 }, deps(jest.fn().mockRejectedValue(new Error('network'))))).status).toBe(502);
    expect(
      (await handleSearchFoods({ query: 'rice', page: 0 }, deps(jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}), headers: { get: () => null } })))).status
    ).toBe(502);
  });

  it('treats an unreadable upstream body as a bad gateway', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); }, headers: { get: () => null } });

    expect((await handleSearchFoods({ query: 'rice', page: 0 }, deps(fetchFn))).status).toBe(502);
  });

  it('reports how many records were skipped for incomplete nutrition', async () => {
    const fetchFn = jest.fn().mockResolvedValue(ok({ foods: [foundation(), foundation({ fdcId: 9, foodNutrients: [] })] }));

    const result = await handleSearchFoods({ query: 'rice', page: 0 }, deps(fetchFn));

    expect(result.body).toMatchObject({ skipped: 1 });
  });
});

describe('server and app energy consistency rules agree', () => {
  it.each([
    [{ calories: 644, proteinG: 15.5, carbsG: 80, fatG: 28 }],
    [{ calories: 2500, proteinG: 5, carbsG: 15, fatG: 2 }],
    [{ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }],
    [{ calories: 300, proteinG: 0, carbsG: 0, fatG: 0 }],
    [{ calories: 100, proteinG: 5, carbsG: 15, fatG: 2 }],
  ])('%j', (n) => {
    expect(serverConsistent(n)).toBe(clientConsistent(n));
  });
});

describe('search-foods edge function (live)', () => {
  const admin = createAdmin();
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser(admin, 'usda');
  });
  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  it('returns 401 without a JWT', async () => {
    expect((await callFunction('search-foods', undefined, { query: 'rice', page: 0 })).status).toBe(401);
  });

  it('returns 400 for an empty or oversized query', async () => {
    expect((await callFunction('search-foods', user.jwt, { query: '', page: 0 })).status).toBe(400);
    expect((await callFunction('search-foods', user.jwt, { query: 'x'.repeat(200), page: 0 })).status).toBe(400);
  });

  it('never returns a key for a valid request (200 when configured, 503 when not)', async () => {
    const { status, json } = await callFunction('search-foods', user.jwt, { query: 'rice', page: 0 });

    expect([200, 503]).toContain(status);
    expect(JSON.stringify(json).toLowerCase()).not.toContain('api_key');
    expect(JSON.stringify(json).toLowerCase()).not.toContain('x-api-key');
  });
});
