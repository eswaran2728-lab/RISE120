import { createOpenAiCompatibleProvider } from '../openai';
import { CoachProviderError } from '../../../supabase/functions/_shared/coach/types';
import { buildSystemPrompt, buildUserPrompt } from '../../../supabase/functions/_shared/coach/prompt';
import { toContext, parseScenarios } from '../scenarios';
import { RAW_FIXTURE_SCENARIOS } from '../fixtures';

const KEY = 'sk-test-not-a-real-key-24680';
const context = toContext(parseScenarios(RAW_FIXTURE_SCENARIOS)[0]);
const ok = (content: string) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });

function setup(response: unknown | (() => Promise<unknown>)) {
  const fetcher = jest.fn(typeof response === 'function' ? (response as () => Promise<unknown>) : async () => response);
  const provider = createOpenAiCompatibleProvider({ baseUrl: 'https://gateway.example.test/v1/', apiKey: KEY, model: 'm-1', fetcher: fetcher as never });
  return { provider, fetcher };
}

describe('OpenAI-compatible provider (for a gateway such as OmniRoute)', () => {
  it('sends the same versioned prompts as the Gemini adapter, the key only as a bearer header', async () => {
    const { provider, fetcher } = setup(ok(JSON.stringify({ reply: 'Hi', proposal: null })));

    await provider.generate(context, 'hello');

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    const body = JSON.parse(init.body);
    expect(url).toBe('https://gateway.example.test/v1/chat/completions');
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(url).not.toContain(KEY);
    expect(init.body).not.toContain(KEY);
    expect(body.model).toBe('m-1');
    expect(body.messages).toEqual([
      { role: 'system', content: buildSystemPrompt(context.language) },
      { role: 'user', content: buildUserPrompt(context, 'hello') },
    ]);
  });

  it('parses the answer through the same validator as the real coach', async () => {
    const { provider } = setup(ok(JSON.stringify({ reply: 'Fine', proposal: { patches: [{ dayNumber: 5, calorieTarget: 2550 }] } })));

    const reply = await provider.generate(context, 'hello');

    expect(reply.text).toBe('Fine');
    expect(reply.proposal?.patches[0].next.calorieTarget).toBe(2550);
  });

  it('maps failures to provider errors that never carry the key or the response', async () => {
    const http = setup({ ok: false, status: 503, json: async () => ({ error: KEY }) });
    const bad = setup(ok('not json'));
    const down = setup(async () => {
      throw new Error(`socket closed ${KEY}`);
    });

    const errors = await Promise.all([http, bad, down].map((s) => s.provider.generate(context, 'hello').catch((e) => e)));

    for (const error of errors) {
      expect(error).toBeInstanceOf(CoachProviderError);
      expect(error.message).not.toContain(KEY);
    }
    expect(errors[0]).toMatchObject({ kind: 'unavailable', outcomeUnknown: true }); // a 5xx from a gateway may already have been generated and billed
    expect(errors[1]).toMatchObject({ kind: 'invalid' });
    expect(errors[2]).toMatchObject({ kind: 'unavailable', outcomeUnknown: true });
  });

  it('is misconfigured without a key, a model or a base URL, and makes no request', async () => {
    const fetcher = jest.fn();
    const provider = createOpenAiCompatibleProvider({ baseUrl: '', apiKey: '', model: '', fetcher: fetcher as never });

    await expect(provider.generate(context, 'hello')).rejects.toMatchObject({ kind: 'misconfigured' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

// Synthetic gateway behaviour. A gateway can hide several provider attempts behind one answer, so the adapter must
// never add retries of its own, must stop at one end-to-end deadline, and must treat anything that may already have
// been generated and billed as an unknown outcome (never retried under the same Rise120 request id).
describe('gateway failure modes (synthetic)', () => {
  const answer = (content: string, extra: Record<string, unknown> = {}) => ({ ok: true, status: 200, json: async () => ({ model: 'm-1', choices: [{ message: { content } }], ...extra }) });
  const good = JSON.stringify({ reply: 'Fine', proposal: null });
  const attempt = async (response: unknown | (() => Promise<unknown>), timeoutMs = 50) => {
    const fetcher = jest.fn(typeof response === 'function' ? (response as () => Promise<unknown>) : async () => response);
    const provider = createOpenAiCompatibleProvider({ baseUrl: 'https://gateway.example.test/v1', apiKey: KEY, model: 'm-1', fetcher: fetcher as never, timeoutMs });
    const result = await provider.generate(context, 'hello').then((reply) => ({ reply }), (error) => ({ error }));
    return { fetcher, ...result } as { fetcher: jest.Mock; reply?: { text: string }; error?: CoachProviderError };
  };

  it('treats an unreachable host as an unknown outcome', async () => {
    const { error } = await attempt(async () => {
      throw new TypeError('fetch failed');
    });

    expect(error).toMatchObject({ kind: 'unavailable', outcomeUnknown: true });
  });

  it('stops at one deadline when the headers arrive and the body stalls, and aborts the read', async () => {
    let signal: AbortSignal | undefined;
    const fetcher = jest.fn(async (_url: string, init: { signal?: AbortSignal }) => {
      signal = init.signal;
      return { ok: true, status: 200, json: () => new Promise(() => undefined) };
    });
    const provider = createOpenAiCompatibleProvider({ baseUrl: 'https://gateway.example.test/v1', apiKey: KEY, model: 'm-1', fetcher: fetcher as never, timeoutMs: 20 });

    const error = await provider.generate(context, 'hello').catch((e) => e);

    expect(error).toMatchObject({ kind: 'timeout', outcomeUnknown: true });
    expect(signal?.aborted).toBe(true);
  });

  it('rejects malformed JSON and an answer with no content, as known invalid answers', async () => {
    const malformed = await attempt({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } });
    const empty = await attempt({ ok: true, status: 200, json: async () => ({ model: 'm-1', choices: [] }) });

    expect(malformed.error).toMatchObject({ kind: 'invalid', outcomeUnknown: false });
    expect(empty.error).toMatchObject({ kind: 'invalid', outcomeUnknown: false });
  });

  it('rejects an answer produced by a model other than the one asked for, which is what a gateway fallback looks like', async () => {
    const { error } = await attempt(answer(good, { model: 'some-other-model' }));

    expect(error).toMatchObject({ kind: 'invalid', outcomeUnknown: false });
    expect(error?.message).toBe('coach_provider_model_mismatch');
  });

  it('accepts the answer when the gateway reports the same model, or does not report one', async () => {
    expect((await attempt(answer(good))).reply?.text).toBe('Fine');
    expect((await attempt({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: good } }] }) })).reply?.text).toBe('Fine');
  });

  it('maps a rate limit and an auth failure to known failures, never an unknown outcome', async () => {
    const limited = await attempt({ ok: false, status: 429, json: async () => ({}) });
    const unauthorised = await attempt({ ok: false, status: 401, json: async () => ({}) });

    expect(limited.error).toMatchObject({ kind: 'unavailable', outcomeUnknown: false, message: 'coach_provider_http_429' });
    expect(unauthorised.error).toMatchObject({ kind: 'unavailable', outcomeUnknown: false, message: 'coach_provider_http_401' });
  });

  it('treats a server error or gateway timeout as an unknown outcome: the gateway may already have generated, and been billed for, an answer', async () => {
    for (const status of [500, 502, 503, 504]) {
      const { error } = await attempt({ ok: false, status, json: async () => ({}) });
      expect(error).toMatchObject({ kind: 'unavailable', outcomeUnknown: true, message: `coach_provider_http_${status}` });
    }
  });

  it('sends exactly one request for every outcome, so the adapter cannot multiply provider starts or retry a billable answer', async () => {
    const outcomes: unknown[] = [
      answer(good),
      { ok: false, status: 503, json: async () => ({}) },
      { ok: false, status: 429, json: async () => ({}) },
      answer('not json'),
      answer(good, { model: 'other' }),
      async () => {
        throw new TypeError('fetch failed');
      },
    ];

    for (const outcome of outcomes) {
      const { fetcher } = await attempt(outcome as never);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it('reports provider-reported usage, including for an answer that is then rejected', async () => {
    const usage = jest.fn();
    const withUsage = (content: string, extra: Record<string, unknown> = {}) => answer(content, { usage: { prompt_tokens: 200, completion_tokens: 40 }, ...extra });
    const run = (response: unknown) =>
      createOpenAiCompatibleProvider({ baseUrl: 'https://gateway.example.test/v1', apiKey: KEY, model: 'm-1', fetcher: (async () => response) as never, onUsage: usage }).generate(context, 'hello').catch(() => undefined);

    await run(withUsage(good));
    await run(withUsage('not json'));
    await run(withUsage(good, { model: 'other' })); // billed to someone, even though it is rejected

    expect(usage).toHaveBeenCalledTimes(3);
    expect(usage).toHaveBeenCalledWith({ inputTokens: 200, outputTokens: 40 });
  });

  it('never puts the key or any response text in an error', async () => {
    const results = await Promise.all([
      attempt({ ok: false, status: 500, json: async () => ({ error: `${KEY} secret health detail` }) }),
      attempt(answer(`${KEY} knee pain`, { model: 'other' })),
      attempt(answer(`${KEY} knee pain`)),
    ]);

    for (const { error } of results) {
      expect(error?.message ?? '').not.toContain(KEY);
      expect(error?.message ?? '').not.toContain('knee');
      expect(error?.message ?? '').not.toContain('health');
    }
  });
});
