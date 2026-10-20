import { createGeminiProvider } from '../functions/_shared/coach/gemini';
import { COACH_LIMITS, CoachProviderError } from '../functions/_shared/coach/types';
import { SAFE_FALLBACK, buildSystemPrompt, buildUserPrompt } from '../functions/_shared/coach/prompt';
import { baseContext } from './coach-fixtures';

const KEY = 'test-key-not-a-real-secret-123';
const MODEL = 'gemini-test-model';

const candidate = (text: string, finishReason = 'STOP') => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }] });
const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const modelJson = (reply: string, proposal: unknown = null) => JSON.stringify({ reply, proposal });

function setup(response: unknown | (() => Promise<unknown>), options: { timeoutMs?: number } = {}) {
  const fetcher = jest.fn(typeof response === 'function' ? (response as () => Promise<unknown>) : async () => response);
  const provider = createGeminiProvider({ apiKey: KEY, model: MODEL, fetcher: fetcher as never, ...options });
  return { provider, fetcher };
}
const requestOf = (fetcher: jest.Mock) => {
  const [url, init] = fetcher.mock.calls[0];
  return { url: url as string, init: init as { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }, body: JSON.parse(init.body) };
};

describe('Gemini request', () => {
  it('posts to the model endpoint with the key only in a header, and nothing else in the URL', async () => {
    const { provider, fetcher } = setup(okResponse(candidate(modelJson('Hi'))));

    await provider.generate(baseContext(), 'hello');

    const { url, init } = requestOf(fetcher);
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`);
    expect(init.method).toBe('POST');
    expect(init.headers['x-goog-api-key']).toBe(KEY);
    expect(init.headers['content-type']).toBe('application/json');
    expect(url).not.toContain(KEY);
    expect(init.body).not.toContain(KEY);
  });

  it('asks for bounded structured JSON with the versioned safety prompt and explicit safety settings', async () => {
    const { provider, fetcher } = setup(okResponse(candidate(modelJson('Hi'))));
    const context = baseContext({ language: 'ta' });

    await provider.generate(context, 'hello');

    const { body } = requestOf(fetcher);
    expect(body.generationConfig.maxOutputTokens).toBe(COACH_LIMITS.maxOutputTokens);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toBeDefined();
    expect(body.generationConfig.temperature).toBeLessThanOrEqual(0.5);
    expect(body.systemInstruction.parts[0].text).toBe(buildSystemPrompt('ta'));
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: buildUserPrompt(context, 'hello') }] }]);
    expect(body.safetySettings.map((s: { category: string }) => s.category).sort()).toEqual([
      'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    ]);
    expect(new Set(body.safetySettings.map((s: { threshold: string }) => s.threshold))).toEqual(new Set(['BLOCK_MEDIUM_AND_ABOVE']));
  });

  it('sends no photo, email, name or identifier to the model', async () => {
    const { provider, fetcher } = setup(okResponse(candidate(modelJson('Hi'))));

    await provider.generate(baseContext({ checkins: [{ date: '2026-10-14', weightKg: 70, mood: 3, sleepHours: 7 }] }), 'hello');

    const raw = requestOf(fetcher).init.body;
    for (const forbidden of ['email', 'displayName', 'photo', 'userId', 'user_id', '@']) expect(raw).not.toContain(forbidden);
  });

  it('refuses an over-long message before any network call', async () => {
    const { provider, fetcher } = setup(okResponse(candidate(modelJson('Hi'))));

    await expect(provider.generate(baseContext(), 'x'.repeat(COACH_LIMITS.maxMessageChars + 1))).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('is not configured without a key or model, and never calls out', async () => {
    for (const config of [{ apiKey: '', model: MODEL }, { apiKey: KEY, model: '' }]) {
      const fetcher = jest.fn();
      const provider = createGeminiProvider({ ...config, fetcher: fetcher as never });

      const error = await provider.generate(baseContext(), 'hello').catch((e) => e);

      expect(error).toBeInstanceOf(CoachProviderError);
      expect(error.kind).toBe('misconfigured');
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
});

describe('Gemini response', () => {
  it('parses a reply and a proposal into typed values', async () => {
    const proposal = { patches: [{ dayNumber: 5, calorieTarget: 2700 }] };
    const { provider } = setup(okResponse(candidate(modelJson('Eat a bit more.', proposal))));

    const reply = await provider.generate(baseContext(), 'hello');

    expect(reply).toEqual({ text: 'Eat a bit more.', proposal: { patches: [{ dayNumber: 5, next: { calorieTarget: 2700 } }] } });
  });

  it('joins text parts and reads a reply with no proposal', async () => {
    const body = { candidates: [{ content: { parts: [{ text: '{"reply":"Hel' }, { text: 'lo","proposal":null}' }] }, finishReason: 'STOP' }] };
    const { provider } = setup(okResponse(body));

    expect(await provider.generate(baseContext(), 'hello')).toEqual({ text: 'Hello', proposal: null });
  });

  it.each([
    ['a blocked prompt', { promptFeedback: { blockReason: 'SAFETY' } }],
    ['a response stopped for safety', candidate('', 'SAFETY')],
    ['prohibited content', candidate('', 'PROHIBITED_CONTENT')],
    ['a blocklist hit', candidate('', 'BLOCKLIST')],
  ])('answers %s with the safe referral message, in the member language, and no proposal', async (_name, body) => {
    const { provider } = setup(okResponse(body));

    const reply = await provider.generate(baseContext({ language: 'ms' }), 'hello');

    expect(reply).toEqual({ text: SAFE_FALLBACK.ms, proposal: null, refused: true });
  });

  it.each([
    ['malformed JSON', okResponse(candidate('{not json'))],
    ['an overlong reply', okResponse(candidate(modelJson('x'.repeat(COACH_LIMITS.maxReplyChars + 1))))],
    ['output cut off at the token limit', okResponse(candidate('{"reply":"Hel', 'MAX_TOKENS'))],
    ['no candidates and no block reason', okResponse({ candidates: [] })],
    ['an empty body', okResponse({})],
  ])('fails with an "invalid" provider error for %s, and no definite outcome is lost', async (_name, response) => {
    const { provider } = setup(response);

    const error = await provider.generate(baseContext(), 'hello').catch((e) => e);

    expect(error).toBeInstanceOf(CoachProviderError);
    expect(error.kind).toBe('invalid');
    expect(error.outcomeUnknown).toBe(false);
  });

  it('keeps a bad proposal out but still returns the reply text', async () => {
    const { provider } = setup(okResponse(candidate(modelJson('Advice', { patches: [{ dayNumber: 5, sql: 'drop table' }] }))));

    const reply = await provider.generate(baseContext(), 'hello');

    expect(reply.text).toBe('Advice');
    expect(reply.proposal).toBeNull();
    expect(reply.droppedProposal?.length).toBeGreaterThan(0);
  });
});

describe('Gemini failures', () => {
  it('reports an HTTP error as unavailable, with a definite outcome and no key or body in the message', async () => {
    const { provider } = setup({ ok: false, status: 503, json: async () => ({ error: { message: `leaked ${KEY} secret detail` } }) });

    const error = await provider.generate(baseContext(), 'hello').catch((e) => e);

    expect(error).toBeInstanceOf(CoachProviderError);
    expect(error.kind).toBe('unavailable');
    expect(error.outcomeUnknown).toBe(false);
    expect(error.message).not.toContain(KEY);
    expect(error.message).not.toContain('secret detail');
  });

  it('reports a network failure after sending as an unknown outcome', async () => {
    const { provider } = setup(async () => {
      throw new Error(`socket hang up ${KEY}`);
    });

    const error = await provider.generate(baseContext(), 'hello').catch((e) => e);

    expect(error.kind).toBe('unavailable');
    expect(error.outcomeUnknown).toBe(true);
    expect(error.message).not.toContain(KEY);
  });

  it('times out, as an unknown outcome, and aborts the request', async () => {
    let aborted = false;
    const { provider } = setup(
      () => new Promise(() => undefined), // never answers
      { timeoutMs: 20 }
    );
    const original = global.AbortController;
    const seen: AbortSignal[] = [];
    global.AbortController = class extends original {
      constructor() {
        super();
        seen.push(this.signal);
        this.signal.addEventListener('abort', () => (aborted = true));
      }
    } as typeof AbortController;

    try {
      const error = await provider.generate(baseContext(), 'hello').catch((e) => e);

      expect(error.kind).toBe('timeout');
      expect(error.outcomeUnknown).toBe(true);
      expect(aborted).toBe(true);
    } finally {
      global.AbortController = original;
    }
  });

  it('uses the pinned timeout by default', () => {
    expect(COACH_LIMITS.providerTimeoutMs).toBe(20000);
  });

  it('never logs the health content, prompts or key', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    const { provider } = setup({ ok: false, status: 500, json: async () => ({}) });

    await provider.generate(baseContext(), 'my private health message').catch(() => undefined);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });
});

describe('Gemini: one deadline for the whole answer, and provider-reported usage', () => {
  it('stops waiting when the headers arrive but the body stalls, as an unknown outcome', async () => {
    const stalled = { ok: true, status: 200, json: () => new Promise(() => undefined) };
    const { provider } = setup(stalled, { timeoutMs: 20 });

    const error = await provider.generate(baseContext(), 'hello').catch((e) => e);

    expect(error).toBeInstanceOf(CoachProviderError);
    expect(error).toMatchObject({ kind: 'timeout', outcomeUnknown: true });
  });

  it('aborts the request when the deadline passes, so a stalled body is not left reading', async () => {
    let signal: AbortSignal | undefined;
    const stalled = { ok: true, status: 200, json: () => new Promise(() => undefined) };
    const fetcher = jest.fn(async (_url: string, init: { signal?: AbortSignal }) => {
      signal = init.signal;
      return stalled;
    });
    const provider = createGeminiProvider({ apiKey: KEY, model: MODEL, fetcher: fetcher as never, timeoutMs: 20 });

    await provider.generate(baseContext(), 'hello').catch(() => undefined);

    expect(signal?.aborted).toBe(true);
  });

  it('reports the provider-reported token counts, and does so even when the answer is refused or unusable', async () => {
    const usage = jest.fn();
    const withUsage = (body: Record<string, unknown>) => okResponse({ ...body, usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 5, totalTokenCount: 155 } });
    const answered = createGeminiProvider({ apiKey: KEY, model: MODEL, fetcher: (async () => withUsage(candidate(modelJson('Hi')))) as never, onUsage: usage });
    const refused = createGeminiProvider({ apiKey: KEY, model: MODEL, fetcher: (async () => withUsage(candidate('', 'SAFETY'))) as never, onUsage: usage });
    const unusable = createGeminiProvider({ apiKey: KEY, model: MODEL, fetcher: (async () => withUsage(candidate('not json'))) as never, onUsage: usage });

    await answered.generate(baseContext(), 'hello');
    await refused.generate(baseContext(), 'hello');
    await unusable.generate(baseContext(), 'hello').catch(() => undefined);

    expect(usage).toHaveBeenCalledTimes(3);
    expect(usage).toHaveBeenCalledWith({ inputTokens: 120, outputTokens: 35 }); // thinking tokens are billed as output
  });

  it('does not call the usage hook when the provider reports none, and never fails because of a bad usage block', async () => {
    const usage = jest.fn();
    const provider = createGeminiProvider({ apiKey: KEY, model: MODEL, fetcher: (async () => okResponse({ ...candidate(modelJson('Hi')), usageMetadata: { promptTokenCount: 'many' } })) as never, onUsage: usage });

    await expect(provider.generate(baseContext(), 'hello')).resolves.toMatchObject({ text: 'Hi' });
    expect(usage).not.toHaveBeenCalled();
  });
});
