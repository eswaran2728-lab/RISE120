// Google's published AdMob SSV verifier keys. They rotate, and Google asks that they are not cached for
// more than 24 hours, so the cache is short and an unknown key id triggers one throttled refresh.
import type { KeyLookup } from './ssv.ts';

export const KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';

type Fetcher = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface KeyProviderOptions {
  fetcher: Fetcher;
  now: () => number;
  ttlMs: number; // must stay well under 24 hours
  minRefetchMs: number; // floor between refreshes triggered by unknown key ids
}

export function createKeyProvider(options: KeyProviderOptions): KeyLookup {
  let cache: Map<string, string> | null = null;
  let fetchedAt = 0;
  let lastAttempt: number | null = null;
  let inflight: Promise<void> | null = null;

  const load = (): Promise<void> => {
    inflight ??= (async () => {
      lastAttempt = options.now();
      const response = await options.fetcher(KEYS_URL);
      if (!response.ok) throw new Error('admob_keys_unavailable');
      const body = (await response.json()) as { keys?: { keyId?: unknown; base64?: unknown }[] };
      if (!body || !Array.isArray(body.keys)) throw new Error('admob_keys_invalid');
      const next = new Map<string, string>();
      for (const key of body.keys) {
        if ((typeof key.keyId !== 'number' && typeof key.keyId !== 'string') || typeof key.base64 !== 'string') throw new Error('admob_keys_invalid');
        next.set(String(key.keyId), key.base64);
      }
      cache = next;
      fetchedAt = options.now();
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  return {
    async get(keyId) {
      const now = options.now();
      const fresh = cache !== null && now - fetchedAt < options.ttlMs;
      if (fresh && cache!.has(keyId)) return cache!.get(keyId)!;
      const throttled = fresh && lastAttempt !== null && now - lastAttempt < options.minRefetchMs;
      if (!throttled) await load();
      return cache?.get(keyId) ?? null;
    },
  };
}
