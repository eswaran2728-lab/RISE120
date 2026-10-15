// The decide-coach-proposal request logic, free of Deno and Supabase so it runs in plain Jest. The caller sends only
// { proposalId, decision }. The account is whatever the caller verified, and the change to apply is the patch
// stored in the database: nothing about the plan ever comes from the request. The database function does the
// real work (ownership, status, eligibility, prior values, all-or-nothing) in one transaction.
export type Decision = 'accept' | 'decline';

export type DecisionResult =
  | { status: 'accepted'; changedDays: number[] }
  | { status: 'declined' }
  | { status: 'stale'; reason?: string | null }
  | { status: 'conflict'; current: string }
  | { status: 'not_found' };

export interface DecisionPort {
  decide(userId: string, proposalId: string, decision: Decision): Promise<DecisionResult>;
}

export interface DecisionResponse {
  status: number;
  body: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid: DecisionResponse = { status: 400, body: { error: 'INVALID_REQUEST' } };

export async function handleDecision(input: { userId: string; body: unknown }, port: DecisionPort): Promise<DecisionResponse> {
  const raw = input.body;
  // Exactly two fields: any extra one (a patch, a workout, a user id) is refused, not ignored.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return invalid;
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== 'proposalId' && key !== 'decision')) return invalid;
  const { proposalId, decision } = body;
  if (typeof proposalId !== 'string' || !UUID.test(proposalId) || (decision !== 'accept' && decision !== 'decline')) return invalid;

  let result: DecisionResult;
  try {
    result = await port.decide(input.userId, proposalId, decision);
  } catch {
    return { status: 503, body: { error: 'COACH_UNAVAILABLE' } };
  }

  switch (result.status) {
    case 'accepted':
      return { status: 200, body: { status: 'accepted', proposalId, changedDays: result.changedDays } };
    case 'declined':
      return { status: 200, body: { status: 'declined', proposalId } };
    case 'stale':
      return { status: 409, body: { error: 'PROPOSAL_STALE', reason: result.reason ?? null } };
    case 'conflict':
      return { status: 409, body: { error: 'DECISION_CONFLICT', current: result.current } };
    case 'not_found':
      return { status: 404, body: { error: 'PROPOSAL_NOT_FOUND' } };
    default:
      return { status: 503, body: { error: 'COACH_UNAVAILABLE' } };
  }
}
