import { handleDecision, DecisionPort } from '../functions/_shared/coach/decide';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PROPOSAL = '33333333-3333-4333-8333-333333333333';

const makePort = (result: Awaited<ReturnType<DecisionPort['decide']>> = { status: 'accepted', changedDays: [5, 8] }) => ({
  decide: jest.fn<ReturnType<DecisionPort['decide']>, [string, string, 'accept' | 'decline']>(async () => result),
});
const send = (port: DecisionPort, body: unknown = { proposalId: PROPOSAL, decision: 'accept' }, userId = USER) => handleDecision({ userId, body }, port);

describe('request validation: only { proposalId, decision }', () => {
  it.each([
    ['no body', null],
    ['not an object', 'accept'],
    ['no proposal id', { decision: 'accept' }],
    ['a proposal id that is not a UUID', { proposalId: 'abc', decision: 'accept' }],
    ['no decision', { proposalId: PROPOSAL }],
    ['an unknown decision', { proposalId: PROPOSAL, decision: 'maybe' }],
    ['a decision in the wrong case', { proposalId: PROPOSAL, decision: 'ACCEPT' }],
    ['replacement patch content from the client', { proposalId: PROPOSAL, decision: 'accept', patch: { patches: [] } }],
    ['a workout from the client', { proposalId: PROPOSAL, decision: 'accept', workout: { kind: 'rest' } }],
    ['a user id from the client', { proposalId: PROPOSAL, decision: 'accept', userId: OTHER }],
    ['extra fields of any kind', { proposalId: PROPOSAL, decision: 'decline', note: 'x' }],
  ])('rejects %s with 400 before touching the database', async (_name, body) => {
    const port = makePort();

    const res = await send(port, body);

    expect(res).toEqual({ status: 400, body: { error: 'INVALID_REQUEST' } });
    expect(port.decide).not.toHaveBeenCalled();
  });
});

describe('decisions', () => {
  it('passes only the verified account, the proposal id and the decision to the database', async () => {
    const port = makePort();

    await send(port);

    expect(port.decide).toHaveBeenCalledWith(USER, PROPOSAL, 'accept');
  });

  it('answers an accepted proposal with the changed days', async () => {
    expect(await send(makePort({ status: 'accepted', changedDays: [5, 8] }))).toEqual({
      status: 200,
      body: { status: 'accepted', proposalId: PROPOSAL, changedDays: [5, 8] },
    });
  });

  it('answers a declined proposal', async () => {
    const res = await send(makePort({ status: 'declined' }), { proposalId: PROPOSAL, decision: 'decline' });

    expect(res).toEqual({ status: 200, body: { status: 'declined', proposalId: PROPOSAL } });
  });

  it('answers a stale proposal with 409 and the reason, without changing anything', async () => {
    const res = await send(makePort({ status: 'stale', reason: 'stale_plan' }));

    expect(res).toEqual({ status: 409, body: { error: 'PROPOSAL_STALE', reason: 'stale_plan' } });
  });

  it('answers the opposite of an earlier decision with 409', async () => {
    const res = await send(makePort({ status: 'conflict', current: 'accepted' }), { proposalId: PROPOSAL, decision: 'decline' });

    expect(res).toEqual({ status: 409, body: { error: 'DECISION_CONFLICT', current: 'accepted' } });
  });

  it('answers a proposal that is not the account\'s as not found, the same as one that does not exist', async () => {
    expect(await send(makePort({ status: 'not_found' }))).toEqual({ status: 404, body: { error: 'PROPOSAL_NOT_FOUND' } });
  });

  it('answers 503 for a database failure or an unexpected answer, with no detail', async () => {
    const failing = { decide: jest.fn(async () => { throw new Error('secret db detail'); }) };
    const odd = makePort({ status: 'surprise' } as never);

    expect(await send(failing)).toEqual({ status: 503, body: { error: 'COACH_UNAVAILABLE' } });
    expect(await send(odd)).toEqual({ status: 503, body: { error: 'COACH_UNAVAILABLE' } });
  });

  it('writes nothing to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));

    await send(makePort());
    await send({ decide: async () => { throw new Error('boom'); } });

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });
});
