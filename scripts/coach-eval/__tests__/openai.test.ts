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
    expect(errors[0]).toMatchObject({ kind: 'unavailable', outcomeUnknown: false });
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
