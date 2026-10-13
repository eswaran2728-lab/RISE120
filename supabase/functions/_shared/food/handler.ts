// Request handling for search-foods, separated from Deno so it can be tested with a mocked
// upstream. The USDA key is only ever sent to USDA in a header and never appears in a response.
import { parseUsdaSearch } from './usda.ts';

const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const PAGE_SIZE = 20;
const MAX_PAGE = 20;
const MIN_QUERY = 2;
const MAX_QUERY = 80;
const DEFAULT_TIMEOUT_MS = 8000;

export interface HandlerDeps {
  apiKey: string | undefined;
  fetchFn: typeof fetch;
  timeoutMs?: number;
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleSearchFoods(input: { query?: unknown; page?: unknown }, deps: HandlerDeps): Promise<HandlerResult> {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (query.length < MIN_QUERY || query.length > MAX_QUERY) return { status: 400, body: { error: 'invalid_query' } };

  const page = input.page === undefined ? 0 : input.page;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 0 || page > MAX_PAGE) {
    return { status: 400, body: { error: 'invalid_page' } };
  }

  if (!deps.apiKey) return { status: 503, body: { error: 'not_configured' } };

  const params = new URLSearchParams({
    query,
    pageSize: String(PAGE_SIZE),
    pageNumber: String(page + 1),
    dataType: 'Foundation,SR Legacy,Branded',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await deps.fetchFn(`${USDA_SEARCH_URL}?${params}`, {
      headers: { 'X-Api-Key': deps.apiKey },
      signal: controller.signal,
    });
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      return { status: 429, body: Number.isFinite(retryAfter) && retryAfter > 0 ? { error: 'rate_limited', retryAfter } : { error: 'rate_limited' } };
    }
    if (!response.ok) return { status: 502, body: { error: 'upstream_error' } };

    let upstream: unknown;
    try {
      upstream = await response.json();
    } catch {
      return { status: 502, body: { error: 'upstream_error' } };
    }
    const { foods, skipped, hasMore } = parseUsdaSearch(upstream);
    return { status: 200, body: { foods, skipped, hasMore, page } };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return timedOut ? { status: 504, body: { error: 'upstream_timeout' } } : { status: 502, body: { error: 'upstream_error' } };
  } finally {
    clearTimeout(timer);
  }
}
