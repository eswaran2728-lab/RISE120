import { supabase } from '../../lib/supabase';
import { BarcodeLookupError, isValidBarcode, lookupBarcode } from '../barcode';

jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() } } }));

const VALID = '5449000000996';

const preview = {
  source: 'openfoodfacts', sourceId: VALID, barcode: VALID, name: 'Cola', brand: 'Acme', servingDesc: '100 g',
  calories: 42, proteinG: 0, carbsG: 10.6, fatG: 0, verified: false, sourceUrl: `https://world.openfoodfacts.org/product/${VALID}`,
};

describe('isValidBarcode', () => {
  it('accepts EAN-13, UPC-A and EAN-8 with a correct check digit', () => {
    expect(isValidBarcode(VALID)).toBe(true);
    expect(isValidBarcode('036000291452')).toBe(true);
    expect(isValidBarcode('96385074')).toBe(true);
  });

  it('rejects bad check digits, letters and odd lengths', () => {
    expect(isValidBarcode('5449000000997')).toBe(false);
    expect(isValidBarcode('abc')).toBe(false);
    expect(isValidBarcode('12345')).toBe(false);
    expect(isValidBarcode(' 5449000000996')).toBe(false);
  });
});

describe('lookupBarcode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the unverified, source-labelled preview', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: { found: true, complete: true, product: preview }, error: null });

    const result = await lookupBarcode(VALID);

    expect(supabase.functions.invoke).toHaveBeenCalledWith('lookup-barcode', { method: 'POST', body: { barcode: VALID } });
    expect(result).toEqual({ found: true, complete: true, product: preview });
  });

  it('returns not found and incomplete outcomes', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({ data: { found: false }, error: null });
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({ data: { found: true, complete: false, name: 'Mystery' }, error: null });

    expect(await lookupBarcode(VALID)).toEqual({ found: false });
    expect(await lookupBarcode(VALID)).toEqual({ found: true, complete: false, name: 'Mystery' });
  });

  it('rejects an invalid barcode locally without calling the function', async () => {
    await expect(lookupBarcode('12345')).rejects.toMatchObject({ code: 'invalid' });

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it.each([
    [429, 'rate_limited'],
    [503, 'not_configured'],
    [504, 'unavailable'],
    [502, 'unavailable'],
  ])('reports HTTP %i as %s', async (status, code) => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: null, error: { message: 'x', context: { status } } });

    await expect(lookupBarcode(VALID)).rejects.toMatchObject({ code });
  });

  it('reports no connection as offline', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: null, error: { message: 'Failed to send a request to the Edge Function' } });

    await expect(lookupBarcode(VALID)).rejects.toMatchObject({ code: 'offline' });
    await expect(lookupBarcode(VALID)).rejects.toBeInstanceOf(BarcodeLookupError);
  });

  it('never writes anything: no database access, so nothing is cached or logged', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: { found: true, complete: true, product: preview }, error: null });

    await lookupBarcode(VALID);

    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('treats a malformed response as unavailable', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: { weird: true }, error: null });

    await expect(lookupBarcode(VALID)).rejects.toMatchObject({ code: 'unavailable' });
  });
});
