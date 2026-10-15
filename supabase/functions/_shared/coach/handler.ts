// The ai-coach request logic, free of Deno and Supabase so it runs in plain Jest with a fake provider. The account
// is whatever the caller verified (never read from the body). Order matters for money and safety:
//   reserve a slot  ->  context  ->  provider  ->  validate  ->  store the reply (charges once)
// A failure that is KNOWN to have produced no answer releases the slot and charges nothing. A provider outcome
// that is UNKNOWN (timeout, dropped connection) leaves the request unresolved: it is never regenerated on the same
// request id and nothing is charged, and the reservation's lease frees the slot again shortly after.
import { CoachContext, CoachLanguage, CoachProposal, CoachProposalPatch, CoachProvider, CoachProviderError, CoachValidationError } from './types.ts';
import { validateCoachReply, validateMessage } from './validate.ts';

export interface FinishInput {
  message: string;
  reply: string;
  language: CoachLanguage;
  proposal: CoachProposal | null;
}

export interface StoredExchange {
  messageId: string;
  reply: string;
  language: string;
  proposal: { id: string; status: string; patches: CoachProposalPatch[] } | null;
}

export interface Quota {
  used: number;
  remaining: number | null; // null = unlimited (premium)
  resetsAt: string;
}

export interface LedgerPort {
  reserve(
    userId: string,
    requestId: string
  ): Promise<{ status: 'reserved' | 'completed' | 'in_progress' | 'limited' | 'rate_limited'; resetsAt: string; retryAt?: string }>;
  finish(userId: string, requestId: string, input: FinishInput): Promise<{ status: 'completed' | 'slot_taken' | 'not_found' | 'not_reserved' }>;
  fail(userId: string, requestId: string): Promise<unknown>;
  loadStored(userId: string, requestId: string): Promise<StoredExchange | null>;
}

export interface CoachDeps {
  ledger: LedgerPort;
  loadContext(userId: string): Promise<CoachContext>;
  provider: CoachProvider | null; // null: no provider is configured on this project
  loadQuota(userId: string): Promise<Quota | null>;
}

export interface CoachResponse {
  status: number;
  body: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = (extra: Record<string, unknown> = {}): CoachResponse => ({ status: 503, body: { error: 'COACH_UNAVAILABLE', ...extra } });

async function quotaOf(deps: CoachDeps, userId: string): Promise<Quota | null> {
  try {
    return await deps.loadQuota(userId);
  } catch {
    return null; // the reply is already stored and charged; a missing quota number must not hide it
  }
}

export async function handleCoachRequest(input: { userId: string; body: unknown }, deps: CoachDeps): Promise<CoachResponse> {
  const { userId, body } = input;
  const raw = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  const requestId = raw?.requestId;
  let message: string;
  try {
    if (typeof requestId !== 'string' || !UUID.test(requestId)) throw new CoachValidationError('invalid_request');
    message = validateMessage(raw?.message);
  } catch {
    return { status: 400, body: { error: 'INVALID_REQUEST' } };
  }

  const release = async () => {
    try {
      await deps.ledger.fail(userId, requestId);
    } catch {
      // The lease frees the slot anyway; nothing was charged.
    }
  };

  let reservation;
  try {
    reservation = await deps.ledger.reserve(userId, requestId);
  } catch {
    return unavailable();
  }

  const respondWithStored = async (extra: Record<string, unknown> = {}): Promise<CoachResponse> => {
    let stored: StoredExchange | null;
    try {
      stored = await deps.ledger.loadStored(userId, requestId);
    } catch {
      stored = null;
    }
    if (!stored) return unavailable(); // stored but unreadable: a retry with the same id returns it without a second charge
    return {
      status: 200,
      body: {
        requestId,
        messageId: stored.messageId,
        reply: stored.reply,
        language: stored.language,
        proposal: stored.proposal,
        quota: await quotaOf(deps, userId),
        ...extra,
      },
    };
  };

  if (reservation.status === 'completed') return respondWithStored();
  if (reservation.status === 'in_progress') return { status: 409, body: { error: 'COACH_IN_PROGRESS' } };
  if (reservation.status === 'limited') return { status: 429, body: { error: 'AI_LIMIT_REACHED', resetsAt: reservation.resetsAt } };
  // Too many provider starts (or one already running): nothing was reserved or charged and no provider is called.
  if (reservation.status === 'rate_limited') return { status: 429, body: { error: 'COACH_RATE_LIMITED', retryAt: reservation.retryAt } };

  // Reserved: this call owns the request from here on.
  if (!deps.provider) {
    await release();
    return unavailable();
  }

  let context: CoachContext;
  try {
    context = await deps.loadContext(userId);
  } catch {
    await release();
    return unavailable();
  }

  let reply;
  try {
    reply = await deps.provider.generate(context, message);
  } catch (error) {
    if (error instanceof CoachProviderError && !error.outcomeUnknown) {
      await release();
      return unavailable();
    }
    // Unknown outcome: the provider may have answered. Do not release, charge or regenerate on this request id.
    return unavailable({ outcomeUnknown: true });
  }

  let validated;
  try {
    // A refusal is a safe referral message: it never carries a proposal.
    validated = validateCoachReply(reply.refused ? { ...reply, proposal: null } : reply, context);
  } catch {
    await release();
    return unavailable();
  }

  let finished;
  try {
    finished = await deps.ledger.finish(userId, requestId, { message, reply: validated.text, language: context.language, proposal: validated.proposal });
  } catch {
    await release();
    return unavailable();
  }
  // The slot went to another request while this one ran: the reply was discarded and must not look like a success.
  if (finished.status === 'slot_taken') return { status: 429, body: { error: 'AI_LIMIT_REACHED', resetsAt: reservation.resetsAt } };
  if (finished.status !== 'completed') return unavailable();

  return respondWithStored({
    ...(reply.refused ? { refused: true } : {}),
    ...(validated.droppedProposal && validated.droppedProposal.length > 0 ? { proposalDropped: true } : {}),
  });
}
