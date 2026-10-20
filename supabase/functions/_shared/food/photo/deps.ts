// Wires the handler to Supabase (service role). The provider is injected: none is configured yet.
import { lookupCandidates } from './catalogue.ts';
import type { PhotoHandlerDeps } from './handler.ts';
import { completePhotoRequest, failPhotoRequest, reservePhotoRequest } from './ledger.ts';
import { FOOD_PHOTO_BUCKET, deletePhotoImage } from './lifecycle.ts';
import type { PhotoProvider } from './provider.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export const DEFAULT_PROVIDER_TIMEOUT_MS = 15000;

// Only a clear "not found" means the image is gone; a 5xx, a 429, a network error or anything unrecognised is transient.
function isNotFound(error: unknown): boolean {
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown } | null;
  if (e?.status === 404 || String(e?.statusCode) === '404') return true;
  return typeof e?.message === 'string' && /object not found|not[_ ]found/i.test(e.message);
}

export function createFoodPhotoDeps(db: Db, provider: PhotoProvider | null, options: { providerTimeoutMs?: number } = {}): PhotoHandlerDeps {
  return {
    reserve: (userId, requestId, imagePath) => reservePhotoRequest(db, userId, requestId, imagePath),
    complete: (userId, requestId, result) => completePhotoRequest(db, userId, requestId, result),
    fail: (userId, requestId) => failPhotoRequest(db, userId, requestId),
    // Resolves to the bytes, or null when the object is genuinely not there (cleanup removed it). Any other Storage failure
    // is transient and THROWS, so the handler can release the request for a retry without treating the image as gone.
    async readImage(path) {
      const { data, error } = await db.storage.from(FOOD_PHOTO_BUCKET).download(path);
      if (error) {
        if (isNotFound(error)) return null;
        throw new Error('food_photo_read_failed');
      }
      if (!data) throw new Error('food_photo_read_failed');
      return new Uint8Array(await data.arrayBuffer());
    },
    deleteImage: (path) => deletePhotoImage(db, path),
    lookup: (guesses) => lookupCandidates(db, guesses as never),
    provider,
    providerTimeoutMs: options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
  };
}
