// Parsing for the analyse-food-photo endpoint. The account always comes from the verified token. Anything else in the
// body (including any nutrition a client might send) is ignored and never stored. The image reference must be exactly
// this member's own generated path for this request id, which also rules out check-in photo paths.
import { foodPhotoPath } from './lifecycle.ts';

export type PhotoRequest = { ok: true; requestId: string; imagePath: string } | { ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePhotoRequest(userId: string, body: unknown): PhotoRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  if (typeof b.requestId !== 'string' || !UUID.test(b.requestId) || typeof b.privateImageRef !== 'string') return { ok: false };
  const requestId = b.requestId.toLowerCase();
  if (b.privateImageRef !== foodPhotoPath(userId, requestId)) return { ok: false };
  return { ok: true, requestId, imagePath: b.privateImageRef };
}
