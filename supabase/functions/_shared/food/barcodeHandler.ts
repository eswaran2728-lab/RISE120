// Request handling for lookup-barcode, separated from Deno so it can be tested with a mocked
// upstream. Read-only: it never writes to the database. Identifies Rise120 to Open Food Facts with
// a contact in the User-Agent, as their API guidance requires.
import { isValidBarcode, toLookupCode } from './barcode.ts';
import { parseOffProduct } from './off.ts';

const OFF_PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS = 'code,product_name,brands,serving_size,nutriments';
const DEFAULT_TIMEOUT_MS = 8000;

export interface BarcodeDeps {
  contact: string | undefined;
  fetchFn: typeof fetch;
  timeoutMs?: number;
}

export interface BarcodeResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleBarcodeLookup(input: { barcode?: unknown }, deps: BarcodeDeps): Promise<BarcodeResult> {
  if (!isValidBarcode(input.barcode)) return { status: 400, body: { error: 'invalid_barcode' } };
  const contact = deps.contact?.trim();
  if (!contact) return { status: 503, body: { error: 'not_configured' } };

  const code = toLookupCode(input.barcode as string);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await deps.fetchFn(`${OFF_PRODUCT_URL}/${code}?fields=${FIELDS}`, {
      method: 'GET',
      headers: { 'User-Agent': `Rise120/1.0 (${contact})`, Accept: 'application/json' },
      signal: controller.signal,
    });
    // Open Food Facts answers 429, or 503 when a global limit is exceeded.
    if (response.status === 429 || response.status === 503) {
      const retryAfter = Number(response.headers.get('retry-after'));
      return { status: 429, body: Number.isFinite(retryAfter) && retryAfter > 0 ? { error: 'rate_limited', retryAfter } : { error: 'rate_limited' } };
    }
    if (response.status === 404) return { status: 200, body: { found: false } };
    if (!response.ok) return { status: 502, body: { error: 'upstream_error' } };

    let upstream: unknown;
    try {
      upstream = await response.json();
    } catch {
      return { status: 502, body: { error: 'upstream_error' } };
    }
    return { status: 200, body: { ...parseOffProduct(upstream, code) } };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return timedOut ? { status: 504, body: { error: 'upstream_timeout' } } : { status: 502, body: { error: 'upstream_error' } };
  } finally {
    clearTimeout(timer);
  }
}
