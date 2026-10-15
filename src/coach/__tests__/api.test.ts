import { supabase } from '../../lib/supabase';
import { decideProposal, loadHistory, sendCoachMessage } from '../api';

jest.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() }, from: jest.fn() } }));

const invoke = supabase.functions.invoke as jest.Mock;
const REQ = '33333333-3333-4333-8333-333333333333';
const PROPOSAL = '44444444-4444-4444-8444-444444444444';

const httpError = (status: number, body: unknown) => ({ name: 'FunctionsHttpError', message: 'non-2xx', context: { status, json: async () => body } });
const fetchError = { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' };

const answer = (over: Record<string, unknown> = {}) => ({
  requestId: REQ,
  messageId: 'm1',
  reply: 'Keep going.',
  language: 'en',
  proposal: null,
  quota: { used: 1, remaining: 0, resetsAt: '2026-10-19T00:00:00.000Z' },
  ...over,
});

describe('sendCoachMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends exactly the request id and the message', async () => {
    invoke.mockResolvedValue({ data: answer(), error: null });

    await sendCoachMessage(REQ, 'How is my week?');

    expect(invoke).toHaveBeenCalledWith('ai-coach', { method: 'POST', body: { requestId: REQ, message: 'How is my week?' } });
  });

  it('turns an answer into an exchange, keeping the message that was sent', async () => {
    const proposal = { id: 'p1', status: 'pending', patches: [{ dayNumber: 5, next: { calorieTarget: 2750 }, expected: { workout: { kind: 'rest' }, calorieTarget: 2650, proteinTargetG: 125 } }] };
    invoke.mockResolvedValue({ data: answer({ proposal, refused: true, proposalDropped: true }), error: null });

    const result = await sendCoachMessage(REQ, 'How is my week?');

    expect(result).toEqual({
      kind: 'answered',
      refused: true,
      proposalDropped: true,
      exchange: { requestId: REQ, messageId: 'm1', message: 'How is my week?', reply: 'Keep going.', language: 'en', createdAt: null, proposal },
    });
  });

  it('treats an answer without a proposal as having none', async () => {
    invoke.mockResolvedValue({ data: answer({ proposal: undefined }), error: null });

    const result = await sendCoachMessage(REQ, 'hi');

    expect(result).toMatchObject({ kind: 'answered', refused: false, proposalDropped: false, exchange: { proposal: null } });
  });

  it.each([
    ['the daily limit', httpError(429, { error: 'AI_LIMIT_REACHED', resetsAt: '2026-10-19T00:00:00.000Z' }), { kind: 'limit', resetsAt: '2026-10-19T00:00:00.000Z' }],
    ['a rate limit with its retry time', httpError(429, { error: 'COACH_RATE_LIMITED', retryAt: '2026-10-18T10:00:30.000Z' }), { kind: 'rate_limited', retryAt: '2026-10-18T10:00:30.000Z' }],
    ['a rate limit with no retry time', httpError(429, { error: 'COACH_RATE_LIMITED' }), { kind: 'rate_limited', retryAt: null }],
    ['a request still in progress', httpError(409, { error: 'COACH_IN_PROGRESS' }), { kind: 'in_progress' }],
    ['a known failure', httpError(503, { error: 'COACH_UNAVAILABLE' }), { kind: 'unavailable' }],
    ['an unknown outcome', httpError(503, { error: 'COACH_UNAVAILABLE', outcomeUnknown: true }), { kind: 'unknown_outcome' }],
    ['an invalid request', httpError(400, { error: 'INVALID_REQUEST' }), { kind: 'invalid' }],
    ['an expired session', httpError(401, { error: 'Unauthorized' }), { kind: 'error' }],
    ['an unreadable error body', { name: 'FunctionsHttpError', context: { status: 500, json: async () => { throw new Error('x'); } } }, { kind: 'error' }],
  ])('maps %s', async (_name, error, expected) => {
    invoke.mockResolvedValue({ data: null, error });

    expect(await sendCoachMessage(REQ, 'hi')).toEqual(expected);
  });

  it('reports no response at all as offline (the request may or may not have arrived)', async () => {
    invoke.mockResolvedValue({ data: null, error: fetchError });
    expect(await sendCoachMessage(REQ, 'hi')).toEqual({ kind: 'offline' });

    invoke.mockRejectedValue(new Error('Network request failed'));
    expect(await sendCoachMessage(REQ, 'hi')).toEqual({ kind: 'offline' });
  });

  it('treats a 200 that is not an answer as an error', async () => {
    invoke.mockResolvedValue({ data: { nope: true }, error: null });

    expect(await sendCoachMessage(REQ, 'hi')).toEqual({ kind: 'error' });
  });
});

describe('decideProposal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends exactly the proposal id and the decision, nothing about the plan', async () => {
    invoke.mockResolvedValue({ data: { status: 'declined', proposalId: PROPOSAL }, error: null });

    await decideProposal(PROPOSAL, 'decline');

    expect(invoke).toHaveBeenCalledWith('decide-coach-proposal', { method: 'POST', body: { proposalId: PROPOSAL, decision: 'decline' } });
  });

  it.each([
    ['accepted', { data: { status: 'accepted', proposalId: PROPOSAL, changedDays: [5, 8] }, error: null }, { kind: 'accepted', changedDays: [5, 8] }],
    ['declined', { data: { status: 'declined', proposalId: PROPOSAL }, error: null }, { kind: 'declined' }],
    ['stale', { data: null, error: httpError(409, { error: 'PROPOSAL_STALE', reason: 'stale_plan' }) }, { kind: 'stale' }],
    ['a conflicting decision', { data: null, error: httpError(409, { error: 'DECISION_CONFLICT', current: 'accepted' }) }, { kind: 'conflict', current: 'accepted' }],
    ['not found', { data: null, error: httpError(404, { error: 'PROPOSAL_NOT_FOUND' }) }, { kind: 'not_found' }],
    ['unavailable', { data: null, error: httpError(503, { error: 'COACH_UNAVAILABLE' }) }, { kind: 'error' }],
    ['no response', { data: null, error: fetchError }, { kind: 'offline' }],
  ])('maps %s', async (_name, response, expected) => {
    invoke.mockResolvedValue(response);

    expect(await decideProposal(PROPOSAL, 'accept')).toEqual(expected);
  });

  it('treats a thrown network error as offline and a malformed success as an error', async () => {
    invoke.mockRejectedValueOnce(new Error('Network request failed'));
    expect(await decideProposal(PROPOSAL, 'accept')).toEqual({ kind: 'offline' });

    invoke.mockResolvedValueOnce({ data: { status: 'accepted' }, error: null });
    expect(await decideProposal(PROPOSAL, 'accept')).toEqual({ kind: 'error' });
  });
});

describe('loadHistory', () => {
  const chain = (rows: unknown[], error: unknown = null) => {
    const q: Record<string, jest.Mock> = {};
    for (const name of ['select', 'eq', 'order', 'limit', 'in']) q[name] = jest.fn(() => q);
    (q as unknown as { then: (r: (v: unknown) => void) => void }).then = (resolve) => resolve({ data: rows, error });
    return q;
  };

  it('reads only this account\'s exchanges and proposals, oldest first', async () => {
    const messages = chain([
      { id: 'm2', request_id: 'r2', message: 'second', reply: 'b', language: 'en', created_at: '2026-10-18T10:00:00Z' },
      { id: 'm1', request_id: 'r1', message: 'first', reply: 'a', language: 'ms', created_at: '2026-10-17T10:00:00Z' },
    ]);
    const proposals = chain([{ id: 'p2', request_id: 'r2', patch: { patches: [{ dayNumber: 5, next: { proteinTargetG: 130 }, expected: { workout: { kind: 'rest' }, calorieTarget: 2650, proteinTargetG: 125 } }] }, status: 'accepted' }]);
    (supabase.from as jest.Mock).mockImplementation((table: string) => (table === 'coach_messages' ? messages : proposals));

    const history = await loadHistory('A');

    expect(messages.eq).toHaveBeenCalledWith('user_id', 'A');
    expect(proposals.eq).toHaveBeenCalledWith('user_id', 'A');
    expect(history.map((h) => h.message)).toEqual(['first', 'second']);
    expect(history[0].proposal).toBeNull();
    expect(history[1].proposal).toEqual({ id: 'p2', status: 'accepted', patches: [expect.objectContaining({ dayNumber: 5 })] });
    expect(history[1]).toMatchObject({ requestId: 'r2', messageId: 'm2', language: 'en', createdAt: '2026-10-18T10:00:00Z' });
  });

  it('never selects the account id or other columns than it shows', async () => {
    const messages = chain([]);
    const proposals = chain([]);
    (supabase.from as jest.Mock).mockImplementation((table: string) => (table === 'coach_messages' ? messages : proposals));

    await loadHistory('A');

    expect(messages.select).toHaveBeenCalledWith('id, request_id, message, reply, language, created_at');
  });

  it('throws when the server cannot be read, so the caller can show saved history instead', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => chain([], { message: 'offline' }));

    await expect(loadHistory('A')).rejects.toThrow();
  });
});
