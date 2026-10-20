// The app's only contact with food-photo analysis: one private upload and one function call. The server decides who may
// use it, how often, and what comes back; the app sends no account id and no nutrition, and keeps only the bounded
// references the server returns.
import { File } from 'expo-file-system';
import { supabase } from '../../lib/supabase';
import { Candidate, normalizeCandidates } from './review';

const BUCKET = 'food-photos';

// The only object name the server accepts: the member's own folder and the request id.
export const foodPhotoObjectPath = (userId: string, requestId: string) => `${userId}/${requestId}.jpg`;

export type AnalysisResult =
  | { kind: 'ok'; candidates: Candidate[] }
  | { kind: 'no_match' }
  | { kind: 'in_progress' }
  | { kind: 'limited'; retryAt: string | null }
  | { kind: 'unavailable'; reason: 'disabled' | 'premium_required' | 'config' | 'provider' | 'other' }
  | { kind: 'invalid_image' }
  | { kind: 'failed' } // a known failure: the photo may be tried again
  | { kind: 'unknown' } // the outcome is unknown: it is never re-run automatically
  | { kind: 'offline' }
  | { kind: 'error' };

const REASONS = new Set(['disabled', 'premium_required', 'config', 'provider']);

function fromBody(body: Record<string, unknown> | undefined): AnalysisResult | null {
  switch (body?.status) {
    case 'ok': {
      const candidates = normalizeCandidates(body.candidates);
      return candidates.length > 0 ? { kind: 'ok', candidates } : { kind: 'no_match' };
    }
    case 'no_match':
      return { kind: 'no_match' };
    case 'in_progress':
      return { kind: 'in_progress' };
    case 'limited':
      return { kind: 'limited', retryAt: typeof body.retryAt === 'string' ? body.retryAt : null };
    case 'unavailable':
      return { kind: 'unavailable', reason: REASONS.has(String(body.reason)) ? (body.reason as 'disabled') : 'other' };
    case 'invalid_image':
      return { kind: 'invalid_image' };
    case 'failed':
      return { kind: 'failed' };
    case 'unknown':
      return { kind: 'unknown' };
    default:
      return null;
  }
}

export async function analysePhoto(userId: string, requestId: string): Promise<AnalysisResult> {
  const { data, error } = await supabase.functions.invoke('analyse-food-photo', { method: 'POST', body: { requestId, privateImageRef: foodPhotoObjectPath(userId, requestId) } });
  if (!error) return fromBody((typeof data === 'object' && data !== null ? data : undefined) as Record<string, unknown> | undefined) ?? { kind: 'error' };

  const e = error as { name?: string; context?: { status?: number; json?: () => Promise<unknown> } };
  if (e.name !== 'FunctionsHttpError' || typeof e.context?.status !== 'number') return { kind: 'offline' };
  let body: Record<string, unknown> | undefined;
  try {
    body = (await e.context.json?.()) as Record<string, unknown> | undefined;
  } catch {
    body = undefined;
  }
  return fromBody(body) ?? { kind: 'error' };
}

export type UploadResult = { kind: 'ok' } | { kind: 'offline' } | { kind: 'error' };

// A JPEG, never overwriting: a retry that finds its own object already there has succeeded.
export async function uploadFoodPhoto(userId: string, requestId: string, localUri: string): Promise<UploadResult> {
  try {
    const bytes = await new File(localUri).arrayBuffer();
    const { error } = await supabase.storage.from(BUCKET).upload(foodPhotoObjectPath(userId, requestId), bytes, { contentType: 'image/jpeg', upsert: false });
    if (!error) return { kind: 'ok' };
    const status = String((error as { statusCode?: unknown }).statusCode ?? '');
    return status === '409' || /already exists/i.test(error.message) ? { kind: 'ok' } : { kind: 'error' };
  } catch (failure) {
    return failure instanceof TypeError || /network/i.test(String((failure as Error)?.message)) ? { kind: 'offline' } : { kind: 'error' };
  }
}

// Best effort: the server also deletes the image once it has an answer, and its cleanup removes anything left.
export async function removeUploadedFoodPhoto(userId: string, requestId: string): Promise<void> {
  try {
    await supabase.storage.from(BUCKET).remove([foodPhotoObjectPath(userId, requestId)]);
  } catch {
    // Nothing to do: the server's cleanup covers it.
  }
}
