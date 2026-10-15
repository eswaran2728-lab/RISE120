import { handleCoachRequest, CoachDeps, FinishInput, LedgerPort, StoredExchange } from '../functions/_shared/coach/handler';
import { SAFE_FALLBACK } from '../functions/_shared/coach/prompt';
import { COACH_LIMITS, CoachContext, CoachProviderError, CoachReply } from '../functions/_shared/coach/types';
import { baseContext, EX, workoutEntries } from './coach-fixtures';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const REQ = '33333333-3333-4333-8333-333333333333';
const RESETS = '2026-10-19T00:00:00.000Z';

function makeDeps(over: Partial<CoachDeps> = {}) {
  let lastFinish: FinishInput | null = null;
  const ledger = {
    reserve: jest.fn<ReturnType<LedgerPort['reserve']>, [string, string]>(async () => ({ status: 'reserved', resetsAt: RESETS })),
    finish: jest.fn<ReturnType<LedgerPort['finish']>, [string, string, FinishInput]>(async (_u, _r, input) => {
      lastFinish = input;
      return { status: 'completed' };
    }),
    fail: jest.fn(async () => undefined),
    loadStored: jest.fn(
      async (): Promise<StoredExchange | null> =>
        lastFinish
          ? {
              messageId: 'msg-1',
              reply: lastFinish.reply,
              language: lastFinish.language,
              proposal: lastFinish.proposal ? { id: 'prop-1', status: 'pending', patches: lastFinish.proposal.patches } : null,
            }
          : { messageId: 'msg-0', reply: 'A stored reply', language: 'en', proposal: null }
    ),
  };
  const provider = { generate: jest.fn(async (): Promise<CoachReply> => ({ text: 'Keep going, and rest well.', proposal: null })) };
  const deps: CoachDeps = {
    ledger,
    loadContext: jest.fn(async (): Promise<CoachContext> => baseContext()),
    provider,
    loadQuota: jest.fn(async () => ({ used: 1, remaining: 0, resetsAt: RESETS })),
    ...over,
  };
  return { deps, ledger, provider };
}
const send = (deps: CoachDeps, body: unknown = { requestId: REQ, message: 'How is my week?' }, userId = USER) => handleCoachRequest({ userId, body }, deps);

describe('request validation', () => {
  it.each([
    ['no body', null],
    ['not an object', 'hello'],
    ['no request id', { message: 'hi' }],
    ['a request id that is not a UUID', { requestId: 'abc', message: 'hi' }],
    ['no message', { requestId: REQ }],
    ['an empty message', { requestId: REQ, message: '   ' }],
    ['an over-long message', { requestId: REQ, message: 'x'.repeat(COACH_LIMITS.maxMessageChars + 1) }],
    ['a message that is not text', { requestId: REQ, message: 42 }],
  ])('rejects %s with 400 before touching the ledger or the provider', async (_name, body) => {
    const { deps, ledger, provider } = makeDeps();

    const res = await send(deps, body);

    expect(res).toEqual({ status: 400, body: { error: 'INVALID_REQUEST' } });
    expect(ledger.reserve).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });
});

describe('account and identity', () => {
  it('uses only the verified account, ignoring any user id in the body', async () => {
    const { deps, ledger } = makeDeps();

    await send(deps, { requestId: REQ, message: 'hi', userId: OTHER, user_id: OTHER });

    expect(ledger.reserve).toHaveBeenCalledWith(USER, REQ);
    expect(ledger.finish).toHaveBeenCalledWith(USER, REQ, expect.anything());
    expect(deps.loadContext).toHaveBeenCalledWith(USER);
    expect(JSON.stringify([ledger.reserve.mock.calls, ledger.finish.mock.calls, (deps.loadContext as jest.Mock).mock.calls])).not.toContain(OTHER);
  });

  it('gives the provider the bounded context and the trimmed message, and no identifier', async () => {
    const { deps, provider } = makeDeps();

    await send(deps, { requestId: REQ, message: '  How is my week?  ' });

    expect(provider.generate).toHaveBeenCalledTimes(1);
    const [context, message] = provider.generate.mock.calls[0] as unknown as [CoachContext, string];
    expect(message).toBe('How is my week?');
    const sent = JSON.stringify([context, message]);
    for (const forbidden of [USER, OTHER, REQ, 'email', 'photo', 'display_name']) expect(sent).not.toContain(forbidden);
  });
});

describe('a normal answer', () => {
  it('reserves, asks the provider once, stores the reply, and returns it with the quota', async () => {
    const { deps, ledger, provider } = makeDeps();

    const res = await send(deps);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      requestId: REQ,
      messageId: 'msg-1',
      reply: 'Keep going, and rest well.',
      language: 'en',
      proposal: null,
      quota: { used: 1, remaining: 0, resetsAt: RESETS },
    });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(ledger.finish).toHaveBeenCalledWith(USER, REQ, { message: 'How is my week?', reply: 'Keep going, and rest well.', language: 'en', proposal: null });
    expect(ledger.fail).not.toHaveBeenCalled();
  });

  it('stores a safe proposal with the real prior values and returns its id and pending status', async () => {
    const proposal = { patches: [{ dayNumber: 5, next: { calorieTarget: 2700 } }] };
    const { deps, ledger } = makeDeps({ provider: { generate: jest.fn(async () => ({ text: 'A small change.', proposal })) } });

    const res = await send(deps);

    const stored = ledger.finish.mock.calls[0][2];
    expect(stored.proposal?.patches[0]).toEqual({
      dayNumber: 5,
      next: { calorieTarget: 2700 },
      expected: { workout: { kind: 'workout', exercises: workoutEntries() }, calorieTarget: 2650, proteinTargetG: 125 },
    });
    expect((res.body as { proposal: { id: string; status: string } }).proposal).toMatchObject({ id: 'prop-1', status: 'pending' });
  });

  it('keeps the reply but stores and returns no proposal when it is unsafe', async () => {
    const unsafe = { patches: [{ dayNumber: 5, next: { workout: { kind: 'workout' as const, exercises: [{ exercise_id: EX.ghost, sets: 2, reps: 10 }, ...workoutEntries().slice(1)] } } }] };
    const { deps, ledger } = makeDeps({ provider: { generate: jest.fn(async () => ({ text: 'Try this exercise.', proposal: unsafe })) } });

    const res = await send(deps);

    expect(ledger.finish.mock.calls[0][2].proposal).toBeNull();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reply: 'Try this exercise.', proposal: null, proposalDropped: true });
    expect(JSON.stringify(res.body)).not.toContain('unknown_exercise');
  });

  it('keeps a proposal out for a day that cannot be changed', async () => {
    const past = { patches: [{ dayNumber: 2, next: { calorieTarget: 2700 } }] };
    const { deps, ledger } = makeDeps({ provider: { generate: jest.fn(async () => ({ text: 'Change yesterday.', proposal: past })) } });

    await send(deps);

    expect(ledger.finish.mock.calls[0][2].proposal).toBeNull();
  });

  it('answers 200 with the reply even if the quota cannot be read afterwards', async () => {
    const { deps } = makeDeps({ loadQuota: jest.fn(async () => { throw new Error('db'); }) });

    const res = await send(deps);

    expect(res.status).toBe(200);
    expect((res.body as { quota: unknown }).quota).toBeNull();
  });
});

describe('retries and idempotency', () => {
  it('returns the stored result for a request that already completed, without calling the provider again', async () => {
    const { deps, ledger, provider } = makeDeps();
    ledger.reserve.mockResolvedValue({ status: 'completed', resetsAt: RESETS });

    const res = await send(deps);

    expect(provider.generate).not.toHaveBeenCalled();
    expect(ledger.finish).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requestId: REQ, messageId: 'msg-0', reply: 'A stored reply', proposal: null });
  });

  it('answers COACH_IN_PROGRESS to a retry of an unfinished request and never calls the provider', async () => {
    const { deps, ledger, provider } = makeDeps();
    ledger.reserve.mockResolvedValue({ status: 'in_progress', resetsAt: RESETS });

    const res = await send(deps);

    expect(res).toEqual({ status: 409, body: { error: 'COACH_IN_PROGRESS' } });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(ledger.fail).not.toHaveBeenCalled();
  });

  it('calls the provider at most once for concurrent sends that compete for one slot', async () => {
    let taken = false;
    const { deps, ledger, provider } = makeDeps();
    ledger.reserve.mockImplementation(async () => {
      await Promise.resolve();
      if (taken) return { status: 'limited' as const, resetsAt: RESETS };
      taken = true;
      return { status: 'reserved' as const, resetsAt: RESETS };
    });

    const results = await Promise.all([1, 2, 3].map((i) => send(deps, { requestId: `33333333-3333-4333-8333-33333333333${i}`, message: 'hi' })));

    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429]);
  });
});

describe('quota exhaustion', () => {
  it('answers AI_LIMIT_REACHED with the UTC reset time, without calling the provider or loading the context', async () => {
    const { deps, ledger, provider } = makeDeps();
    ledger.reserve.mockResolvedValue({ status: 'limited', resetsAt: RESETS });

    const res = await send(deps);

    expect(res).toEqual({ status: 429, body: { error: 'AI_LIMIT_REACHED', resetsAt: RESETS } });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(deps.loadContext).not.toHaveBeenCalled();
    expect(ledger.finish).not.toHaveBeenCalled();
  });

  it('does not present a discarded reply as a success when the slot was taken during the call', async () => {
    const { deps, ledger } = makeDeps({ provider: { generate: jest.fn(async () => ({ text: 'This reply must not be shown.', proposal: null })) } });
    ledger.finish.mockResolvedValue({ status: 'slot_taken' });

    const res = await send(deps);

    expect(res).toEqual({ status: 429, body: { error: 'AI_LIMIT_REACHED', resetsAt: RESETS } });
    expect(JSON.stringify(res.body)).not.toContain('must not be shown');
    expect(ledger.loadStored).not.toHaveBeenCalled();
  });
});

describe('failures that charge nothing', () => {
  const failures: [string, () => Promise<CoachReply>][] = [
    ['an HTTP error', async () => { throw new CoachProviderError('unavailable', false, 'coach_provider_http_503'); }],
    ['malformed output', async () => { throw new CoachProviderError('invalid', false, 'coach_provider_bad_output'); }],
    ['a misconfigured provider', async () => { throw new CoachProviderError('misconfigured', false, 'coach_provider_not_configured'); }],
    ['an over-long reply', async () => ({ text: 'x'.repeat(COACH_LIMITS.maxReplyChars + 1), proposal: null })],
    ['an empty reply', async () => ({ text: '   ', proposal: null })],
  ];

  it.each(failures)('releases the reservation and answers COACH_UNAVAILABLE for %s', async (_name, generate) => {
    const { deps, ledger } = makeDeps({ provider: { generate } });

    const res = await send(deps);

    expect(res).toEqual({ status: 503, body: { error: 'COACH_UNAVAILABLE' } });
    expect(ledger.fail).toHaveBeenCalledWith(USER, REQ);
    expect(ledger.finish).not.toHaveBeenCalled();
  });

  it('releases the reservation when no provider is configured, without a model call', async () => {
    const { deps, ledger } = makeDeps({ provider: null });

    const res = await send(deps);

    expect(res).toEqual({ status: 503, body: { error: 'COACH_UNAVAILABLE' } });
    expect(ledger.fail).toHaveBeenCalledWith(USER, REQ);
  });

  it('releases the reservation when the context cannot be loaded', async () => {
    const { deps, ledger, provider } = makeDeps({ loadContext: jest.fn(async () => { throw new Error('db'); }) });

    const res = await send(deps);

    expect(res.status).toBe(503);
    expect(ledger.fail).toHaveBeenCalledWith(USER, REQ);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('releases the reservation when storing the reply fails, and shows no reply', async () => {
    const { deps, ledger } = makeDeps();
    ledger.finish.mockRejectedValue(new Error('db down'));

    const res = await send(deps);

    expect(res).toEqual({ status: 503, body: { error: 'COACH_UNAVAILABLE' } });
    expect(ledger.fail).toHaveBeenCalledWith(USER, REQ);
  });

  it.each([['not_found'], ['not_reserved']])('answers COACH_UNAVAILABLE when the ledger says %s, and shows no reply', async (status) => {
    const { deps, ledger } = makeDeps();
    ledger.finish.mockResolvedValue({ status: status as 'not_found' | 'not_reserved' });

    const res = await send(deps);

    expect(res).toEqual({ status: 503, body: { error: 'COACH_UNAVAILABLE' } });
  });

  it('never puts provider error text, keys or health details in the response', async () => {
    const generate = async (): Promise<CoachReply> => { throw new CoachProviderError('unavailable', false, 'SECRET-KEY-123 my private health message'); };
    const { deps } = makeDeps({ provider: { generate } });

    const res = await send(deps, { requestId: REQ, message: 'my private health message' });

    expect(JSON.stringify(res)).not.toContain('SECRET-KEY-123');
    expect(JSON.stringify(res)).not.toContain('private health');
  });
});

describe('an unknown provider outcome', () => {
  const unknown: [string, () => Promise<CoachReply>][] = [
    ['a timeout', async () => { throw new CoachProviderError('timeout', true, 'coach_provider_timeout'); }],
    ['a network failure after sending', async () => { throw new CoachProviderError('unavailable', true, 'coach_provider_request_failed'); }],
    ['an unexpected error', async () => { throw new Error('boom'); }],
  ];

  it.each(unknown)('leaves the request unresolved after %s: no release, no charge, no regeneration', async (_name, behaviour) => {
    const generate = jest.fn(behaviour);
    const { deps, ledger } = makeDeps({ provider: { generate } });

    const res = await send(deps);

    expect(res).toEqual({ status: 503, body: { error: 'COACH_UNAVAILABLE', outcomeUnknown: true } });
    expect(ledger.fail).not.toHaveBeenCalled();
    expect(ledger.finish).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('answers a retry of the same request as in progress instead of asking the provider again', async () => {
    const timeout = jest.fn(async (): Promise<CoachReply> => { throw new CoachProviderError('timeout', true, 'coach_provider_timeout'); });
    const { deps, ledger } = makeDeps({ provider: { generate: timeout } });
    await send(deps);

    ledger.reserve.mockResolvedValue({ status: 'in_progress', resetsAt: RESETS });
    const retry = await send(deps);

    expect(retry.status).toBe(409);
    expect(timeout).toHaveBeenCalledTimes(1);
  });
});

describe('refused output', () => {
  it('stores and returns the safe referral message with no proposal, marked as refused', async () => {
    const refused: CoachReply = { text: SAFE_FALLBACK.ms, proposal: null, refused: true };
    const { deps, ledger } = makeDeps({
      loadContext: jest.fn(async () => baseContext({ language: 'ms' })),
      provider: { generate: jest.fn(async () => refused) },
    });

    const res = await send(deps);

    expect(ledger.finish).toHaveBeenCalledWith(USER, REQ, { message: 'How is my week?', reply: SAFE_FALLBACK.ms, language: 'ms', proposal: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reply: SAFE_FALLBACK.ms, language: 'ms', proposal: null, refused: true });
  });

  it('never keeps a proposal that arrives together with a refusal', async () => {
    const odd: CoachReply = { text: SAFE_FALLBACK.en, proposal: { patches: [{ dayNumber: 5, next: { calorieTarget: 2700 } }] }, refused: true };
    const { deps, ledger } = makeDeps({ provider: { generate: jest.fn(async () => odd) } });

    await send(deps);

    expect(ledger.finish.mock.calls[0][2].proposal).toBeNull();
  });
});

describe('privacy', () => {
  it('writes nothing to the console, success or failure', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    const ok = makeDeps();
    const bad = makeDeps({ provider: { generate: async () => { throw new Error('private health message'); } } });

    await send(ok.deps, { requestId: REQ, message: 'private health message' });
    await send(bad.deps, { requestId: REQ, message: 'private health message' });

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });
});

describe('rate limiting', () => {
  const RETRY_AT = '2026-10-19T00:00:30.000Z';

  it('answers COACH_RATE_LIMITED with the server retry time, calling nothing else', async () => {
    const { deps, ledger, provider } = makeDeps();
    ledger.reserve.mockResolvedValue({ status: 'rate_limited', resetsAt: RESETS, retryAt: RETRY_AT });

    const res = await send(deps);

    expect(res).toEqual({ status: 429, body: { error: 'COACH_RATE_LIMITED', retryAt: RETRY_AT } });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(deps.loadContext).not.toHaveBeenCalled();
    expect(ledger.finish).not.toHaveBeenCalled();
    expect(ledger.fail).not.toHaveBeenCalled();
    expect(deps.loadQuota).not.toHaveBeenCalled();
  });

  it('is told apart from running out of daily messages', async () => {
    const { deps, ledger } = makeDeps();
    ledger.reserve.mockResolvedValue({ status: 'rate_limited', resetsAt: RESETS, retryAt: RETRY_AT });
    const rate = await send(deps);
    ledger.reserve.mockResolvedValue({ status: 'limited', resetsAt: RESETS });
    const daily = await send(deps);

    expect((rate.body as { error: string }).error).toBe('COACH_RATE_LIMITED');
    expect((daily.body as { error: string }).error).toBe('AI_LIMIT_REACHED');
  });

  it('does not rate limit the replay of a completed request', async () => {
    const { deps, ledger, provider } = makeDeps();
    ledger.reserve.mockResolvedValue({ status: 'completed', resetsAt: RESETS });

    const res = await send(deps);

    expect(res.status).toBe(200);
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
