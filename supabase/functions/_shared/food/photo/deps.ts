// Wires the handler to Supabase (service role). The provider is injected: none is configured yet.
import { lookupCandidates } from './catalogue.ts';
import type { PhotoHandlerDeps } from './handler.ts';
import { completePhotoRequest, failPhotoRequest, reservePhotoRequest } from './ledger.ts';
import { FOOD_PHOTO_BUCKET, deletePhotoImage } from './lifecycle.ts';
import type { PhotoProvider } from './provider.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export const DEFAULT_PROVIDER_TIMEOUT_MS = 15000;

export function createFoodPhotoDeps(db: Db, provider: PhotoProvider | null, options: { providerTimeoutMs?: number } = {}): PhotoHandlerDeps {
  return {
    reserve: (userId, requestId, imagePath) => reservePhotoRequest(db, userId, requestId, imagePath),
    complete: (userId, requestId, result) => completePhotoRequest(db, userId, requestId, result),
    fail: (userId, requestId) => failPhotoRequest(db, userId, requestId),
    async readImage(path) {
      const { data, error } = await db.storage.from(FOOD_PHOTO_BUCKET).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    deleteImage: (path) => deletePhotoImage(db, path),
    lookup: (guesses) => lookupCandidates(db, guesses as never),
    provider,
    providerTimeoutMs: options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
  };
}
