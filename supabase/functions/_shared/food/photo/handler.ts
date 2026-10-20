// The analyse-food-photo flow, free of Deno and Supabase so it can be tested with a fake provider. It decides nothing about
// quota (the ledger does), never writes a food log, and never accepts nutrition from the client.
//
//   reserve -> read the image -> check the bytes -> ONE provider call under ONE deadline -> resolve references against the
//   catalogue -> store the one result -> delete the image.
//
// A known failure is recorded and the image deleted. A timeout, or anything that may already have been processed, is an
// UNKNOWN outcome: the request stays unresolved, the same id is never started again, and a late answer is ignored.
import { withDeadline } from '../../coach/deadline.ts';
import { inspectFoodPhoto } from './image.ts';
import type { Candidate } from './catalogue.ts';
import { PhotoProvider, PhotoProviderError } from './provider.ts';
import { parsePhotoRequest } from './request.ts';
import type { PhotoAdmission, PhotoResult } from './ledger.ts';

export interface PhotoHandlerDeps {
  reserve(userId: string, requestId: string, imagePath: string): Promise<PhotoAdmission>;
  complete(userId: string, requestId: string, result: PhotoResult): Promise<{ status: string; result?: PhotoResult }>;
  fail(userId: string, requestId: string): Promise<unknown>;
  readImage(path: string): Promise<Uint8Array | null>;
  deleteImage(path: string): Promise<void>;
  lookup(guesses: unknown[]): Promise<Candidate[]>;
  provider: PhotoProvider | null;
  providerTimeoutMs: number;
}

export interface PhotoHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

const reply = (status: number, body: Record<string, unknown>): PhotoHandlerResult => ({ status, body });
const stored = (result: PhotoResult) => reply(200, { status: result.status, candidates: result.candidates });

export async function handleFoodPhotoRequest(input: { userId: string; body: unknown }, deps: PhotoHandlerDeps): Promise<PhotoHandlerResult> {
  const request = parsePhotoRequest(input.userId, input.body);
  if (!request.ok) return reply(400, { error: 'invalid_request' });
  const { requestId, imagePath } = request;
  const { userId } = input;

  let admission: PhotoAdmission;
  try {
    admission = await deps.reserve(userId, requestId, imagePath);
  } catch {
    return reply(500, { error: 'Could not complete that' });
  }
  if (admission.status === 'completed') return stored(admission.result);
  if (admission.status === 'in_progress') return reply(409, { status: 'in_progress' });
  if (admission.status === 'limited') return reply(429, { status: 'limited', retryAt: admission.resetsAt });
  if (admission.status === 'unavailable') return reply(503, { status: 'unavailable', reason: admission.reason });

  // Admitted. Anything that ends the request with a KNOWN outcome releases it and removes the image.
  const release = async () => {
    await deps.fail(userId, requestId).catch(() => undefined);
    await deps.deleteImage(imagePath).catch(() => undefined);
  };

  if (!deps.provider) {
    await release();
    return reply(503, { status: 'unavailable', reason: 'provider' });
  }

  let image: Uint8Array | null;
  try {
    image = await deps.readImage(imagePath);
  } catch {
    return reply(500, { error: 'Could not complete that' }); // could not even look: unresolved, retried by lease expiry
  }
  if (!image) {
    await release();
    return reply(422, { status: 'invalid_image', reason: 'missing' });
  }
  const inspected = inspectFoodPhoto(image);
  if (!inspected.ok) {
    await release();
    return reply(422, { status: 'invalid_image', reason: inspected.reason });
  }

  let guesses: unknown;
  try {
    const provider = deps.provider;
    const bytes = image;
    guesses = await withDeadline(deps.providerTimeoutMs, (signal) => provider.identify(bytes, { signal }));
  } catch (error) {
    if (error instanceof PhotoProviderError && !error.outcomeUnknown) {
      await release();
      return reply(502, { status: 'failed' });
    }
    // A timeout, or an error after which the provider may have answered: unknown. Never started again under this id.
    return reply(504, { status: 'unknown' });
  }
  if (!Array.isArray(guesses)) {
    await release();
    return reply(502, { status: 'failed' });
  }

  let candidates: Candidate[];
  try {
    candidates = await deps.lookup(guesses);
  } catch {
    return reply(504, { status: 'unknown' }); // the provider has answered and been billed: do not run it again
  }

  const result: PhotoResult = { status: candidates.length > 0 ? 'ok' : 'no_match', candidates };
  let done: { status: string; result?: PhotoResult };
  try {
    done = await deps.complete(userId, requestId, result);
  } catch {
    return reply(504, { status: 'unknown' });
  }
  await deps.deleteImage(imagePath).catch(() => undefined); // gone as soon as the result is stored; cleanup covers a failure here
  return stored(done.result ?? result);
}
