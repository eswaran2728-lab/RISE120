import { handleBarcodeLookup } from '../functions/_shared/food/barcodeHandler';
import { isValidBarcode, toLookupCode } from '../functions/_shared/food/barcode';
import { parseOffProduct } from '../functions/_shared/food/off';
import { isValidBarcode as appIsValidBarcode } from '../../src/food/barcode';
import { callFunction, createAdmin, createTestUser, TestUser } from './helpers';

jest.setTimeout(60000);

// The app module under test only needs validation here; keep the real client out of the way.
jest.mock('../../src/lib/supabase', () => ({ supabase: {} }));

const VALID_EAN13 = '5449000000996';
const VALID_EAN13_B = '4006381333931';
const VALID_UPCA = '036000291452';
const VALID_EAN8 = '96385074';

const product = (nutriments: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  status: 1,
  code: VALID_EAN13,
  product: { code: VALID_EAN13, product_name: 'Cola', brands: 'Acme', serving_size: '330 ml', nutriments, ...extra },
});

const per100g = { 'energy-kcal_100g': 42, proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0 };
const perServing = { 'energy-kcal_serving': 139, proteins_serving: 0, carbohydrates_serving: 35, fat_serving: 0 };

describe('barcode validation', () => {
  it.each([VALID_EAN13, VALID_EAN13_B, VALID_UPCA, VALID_EAN8])('accepts %s', (code) => {
    expect(isValidBarcode(code)).toBe(true);
  });

  it.each([
    ['a wrong check digit', '5449000000997'],
    ['letters', '54490000009AB'],
    ['too short', '12345'],
    ['too long', '54490000009961'],
    ['an empty string', ''],
    ['spaces', '5449 000000996'],
    ['an 11 digit code', '03600029145'],
  ])('rejects %s', (_label, code) => {
    expect(isValidBarcode(code)).toBe(false);
  });

  it('pads a 12 digit UPC-A to 13 digits for lookup and leaves other lengths alone', () => {
    expect(toLookupCode(VALID_UPCA)).toBe(`0${VALID_UPCA}`);
    expect(toLookupCode(VALID_EAN13)).toBe(VALID_EAN13);
    expect(toLookupCode(VALID_EAN8)).toBe(VALID_EAN8);
  });

  it('server and app validation agree', () => {
    for (const code of [VALID_EAN13, VALID_UPCA, VALID_EAN8, '5449000000997', 'abc', '']) {
      expect(isValidBarcode(code)).toBe(appIsValidBarcode(code));
    }
  });
});

describe('parseOffProduct', () => {
  it('returns an unverified, source-labelled per-100 g preview with complete nutrition', () => {
    const result = parseOffProduct(product(per100g), VALID_EAN13);

    expect(result).toEqual({
      found: true,
      complete: true,
      product: {
        source: 'openfoodfacts',
        sourceId: VALID_EAN13,
        barcode: VALID_EAN13,
        name: 'Cola',
        brand: 'Acme',
        servingDesc: '100 g',
        calories: 42,
        proteinG: 0,
        carbsG: 10.6,
        fatG: 0,
        verified: false,
        sourceUrl: `https://world.openfoodfacts.org/product/${VALID_EAN13}`,
      },
    });
  });

  it('uses per-serving values only when every serving value is present and the serving size is stated', () => {
    const result = parseOffProduct(product(perServing), VALID_EAN13);

    expect(result).toMatchObject({ found: true, complete: true, product: { servingDesc: '330 ml', calories: 139, carbsG: 35 } });
  });

  it('prefers the per-100 g basis when both are available', () => {
    const result = parseOffProduct(product({ ...per100g, ...perServing }), VALID_EAN13);

    expect(result).toMatchObject({ complete: true, product: { servingDesc: '100 g', calories: 42 } });
  });

  it.each([
    ['a mix of per-100 g and per-serving values', { 'energy-kcal_100g': 42, proteins_100g: 0, carbohydrates_serving: 35, fat_serving: 0 }],
    ['missing calories', { proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0 }],
    ['missing fat', { 'energy-kcal_100g': 42, proteins_100g: 0, carbohydrates_100g: 10.6 }],
    ['energy only in kJ', { 'energy_100g': 176, proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0 }],
    ['non-numeric values', { ...per100g, proteins_100g: 'lots' }],
    ['a negative value', { ...per100g, fat_100g: -1 }],
    ['energy far from the macros', { 'energy-kcal_100g': 4200, proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0 }],
    ['no nutrition at all', {}],
  ])('reports %s as incomplete instead of writing zeros', (_label, nutriments) => {
    const result = parseOffProduct(product(nutriments), VALID_EAN13);

    expect(result).toMatchObject({ found: true, complete: false, name: 'Cola' });
    expect(result).not.toHaveProperty('product');
  });

  it('does not use per-serving values when the serving size is unknown', () => {
    const result = parseOffProduct(product(perServing, { serving_size: '' }), VALID_EAN13);

    expect(result).toMatchObject({ found: true, complete: false });
  });

  it('reports a product with no name as incomplete', () => {
    expect(parseOffProduct(product(per100g, { product_name: '  ' }), VALID_EAN13)).toMatchObject({ found: true, complete: false });
  });

  it.each([
    ['status 0', { status: 0, status_verbose: 'product not found' }],
    ['no product', { status: 1 }],
    ['null', null],
    ['a string', 'nope'],
  ])('reports an unknown product for %s', (_label, body) => {
    expect(parseOffProduct(body, VALID_EAN13)).toEqual({ found: false });
  });

  it('never marks a result verified', () => {
    const result = parseOffProduct(product(per100g), VALID_EAN13);

    expect(result.found && result.complete && result.product.verified).toBe(false);
  });
});

describe('handleBarcodeLookup', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });
  const deps = (fetchFn: jest.Mock, contact: string | null = 'owner@example.com') => ({ contact: contact ?? undefined, fetchFn: fetchFn as unknown as typeof fetch });

  it('identifies Rise120 with a contact in the User-Agent and asks for only the fields it needs', async () => {
    const fetchFn = jest.fn().mockResolvedValue(ok(product(per100g)));

    const result = await handleBarcodeLookup({ barcode: VALID_EAN13 }, deps(fetchFn));

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ found: true, complete: true });
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain(`/api/v2/product/${VALID_EAN13}`);
    expect(String(url)).toContain('fields=');
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.headers['User-Agent']).toBe('Rise120/1.0 (owner@example.com)');
  });

  it('looks a 12 digit UPC-A up as a 13 digit code', async () => {
    const fetchFn = jest.fn().mockResolvedValue(ok({ status: 0 }));

    await handleBarcodeLookup({ barcode: VALID_UPCA }, deps(fetchFn));

    expect(String(fetchFn.mock.calls[0][0])).toContain(`/product/0${VALID_UPCA}`);
  });

  it.each([['not a string', 5], ['wrong check digit', '5449000000997'], ['empty', ''], ['letters', 'abcdefghijklm']])(
    'rejects %s with 400 and never calls Open Food Facts',
    async (_label, barcode) => {
      const fetchFn = jest.fn();

      expect((await handleBarcodeLookup({ barcode }, deps(fetchFn))).status).toBe(400);
      expect(fetchFn).not.toHaveBeenCalled();
    }
  );

  it('stays disabled (503) when no contact is configured, without calling upstream', async () => {
    const fetchFn = jest.fn();

    expect((await handleBarcodeLookup({ barcode: VALID_EAN13 }, deps(fetchFn, null))).status).toBe(503);
    expect((await handleBarcodeLookup({ barcode: VALID_EAN13 }, deps(fetchFn, '  '))).status).toBe(503);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns found:false for an unknown product (404 or status 0)', async () => {
    const notFound = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}), headers: { get: () => null } });

    expect((await handleBarcodeLookup({ barcode: VALID_EAN13 }, deps(notFound))).body).toEqual({ found: false });
    expect((await handleBarcodeLookup({ barcode: VALID_EAN13 }, deps(jest.fn().mockResolvedValue(ok({ status: 0 }))))).body).toEqual({ found: false });
  });

  it('maps rate limiting, timeouts and failures to distinct errors', async () => {
    const limited = (status: number) => jest.fn().mockResolvedValue({ ok: false, status, json: async () => ({}), headers: { get: () => '20' } });
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });

    expect(await handleBarcodeLookup({ barcode: VALID_EAN13 }, deps(limited(429)))).toEqual({ status: 429, body: { error: 'rate_limited', retryAfter: 20 } });
    expect((await handleBarcodeLookup({ barcode: VALID_EAN13 }, deps(limited(503)))).status).toBe(429);
    expect((await handleBarcodeLookup({ barcode: VALID_EAN13 }, deps(jest.fn().mockRejectedValue(abort)))).status).toBe(504);
    expect((await handleBarcodeLookup({ barcode: VALID_EAN13 }, deps(jest.fn().mockRejectedValue(new Error('network'))))).status).toBe(502);
    expect((await handleBarcodeLookup({ barcode: VALID_EAN13 }, deps(limited(500)))).status).toBe(502);
  });

  it('treats an unreadable upstream body as a bad gateway', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); }, headers: { get: () => null } });

    expect((await handleBarcodeLookup({ barcode: VALID_EAN13 }, deps(fetchFn))).status).toBe(502);
  });

  it('never echoes the contact address in a response', async () => {
    const responses = [
      await handleBarcodeLookup({ barcode: VALID_EAN13 }, deps(jest.fn().mockResolvedValue(ok(product(per100g))))),
      await handleBarcodeLookup({ barcode: VALID_EAN13 }, deps(jest.fn().mockRejectedValue(new Error('boom owner@example.com')))),
    ];

    for (const response of responses) expect(JSON.stringify(response.body)).not.toContain('owner@example.com');
  });
});

describe('lookup-barcode edge function (live)', () => {
  const admin = createAdmin();
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser(admin, 'barcode');
  });
  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  it('returns 401 without a JWT', async () => {
    expect((await callFunction('lookup-barcode', undefined, { barcode: VALID_EAN13 })).status).toBe(401);
  });

  it('returns 400 for an invalid barcode', async () => {
    expect((await callFunction('lookup-barcode', user.jwt, { barcode: '123' })).status).toBe(400);
  });

  it('is not configured (503) until an Open Food Facts contact is set, and writes nothing', async () => {
    const before = await admin.from('foods').select('id', { count: 'exact', head: true }).eq('source', 'openfoodfacts');

    const { status } = await callFunction('lookup-barcode', user.jwt, { barcode: VALID_EAN13 });

    expect([200, 503]).toContain(status);
    const after = await admin.from('foods').select('id', { count: 'exact', head: true }).eq('source', 'openfoodfacts');
    expect(after.count).toBe(before.count);
  });
});
