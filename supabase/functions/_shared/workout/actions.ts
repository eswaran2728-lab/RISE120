// Pure parsing for the session-actions endpoint (swap the remaining sets of an exercise, finish a session). The
// account always comes from the verified token; only these fields are read from the request.
export type SessionActionRequest =
  | { ok: true; action: 'swap'; requestId: string; sessionId: string; expectedRevision: number; fromExerciseId: string; replacementId: string }
  | { ok: true; action: 'complete'; sessionId: string }
  | { ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXERCISE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseSessionActionRequest(body: unknown): SessionActionRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  if (typeof b.sessionId !== 'string' || !UUID.test(b.sessionId)) return { ok: false };
  const sessionId = b.sessionId.toLowerCase();

  if (b.action === 'complete') return { ok: true, action: 'complete', sessionId };
  if (b.action !== 'swap') return { ok: false };

  if (typeof b.requestId !== 'string' || !UUID.test(b.requestId)) return { ok: false };
  if (typeof b.expectedRevision !== 'number' || !Number.isInteger(b.expectedRevision) || b.expectedRevision < 0) return { ok: false };
  if (typeof b.fromExerciseId !== 'string' || !EXERCISE_ID.test(b.fromExerciseId)) return { ok: false };
  if (typeof b.replacementId !== 'string' || !EXERCISE_ID.test(b.replacementId)) return { ok: false };
  if (b.fromExerciseId === b.replacementId) return { ok: false };
  return { ok: true, action: 'swap', requestId: b.requestId.toLowerCase(), sessionId, expectedRevision: b.expectedRevision, fromExerciseId: b.fromExerciseId, replacementId: b.replacementId };
}
