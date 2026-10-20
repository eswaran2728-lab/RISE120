import { runCli, CliDeps } from '../cli';
import { RAW_FIXTURE_SCENARIOS } from '../fixtures';

const GEMINI_KEY = 'AIza-test-not-a-real-key-111';
const SECOND_KEY = 'sk-test-not-a-real-key-222';
const liveEnv = {
  GEMINI_API_KEY: GEMINI_KEY,
  GEMINI_MODEL: 'gemini-test',
  EVAL_SECOND_BASE_URL: 'https://gateway.example.test/v1',
  EVAL_SECOND_API_KEY: SECOND_KEY,
  EVAL_SECOND_MODEL: 'second-test',
};

function setup(over: { env?: Record<string, string>; files?: Record<string, string>; fetcher?: CliDeps['fetcher'] } = {}) {
  const written: Record<string, string> = {};
  const lines: string[] = [];
  let tick = 0;
  const deps: CliDeps = {
    env: over.env ?? {},
    readFile: async (path) => {
      if (!(over.files ?? {})[path]) throw new Error('ENOENT');
      return (over.files ?? {})[path];
    },
    writeFile: async (path, text) => {
      written[path] = text;
    },
    mkdir: async () => undefined,
    log: (line) => lines.push(line),
    now: () => (tick += 5),
    fetcher: over.fetcher,
  };
  return { deps, written, lines };
}

const goodAnswer = (url: string) =>
  url.includes('generativelanguage')
    ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ reply: 'Your weight is 69.5 kg and steady. Keep up the good work.', proposal: null }) }] } }] }
    : { choices: [{ message: { content: JSON.stringify({ reply: 'Your weight is 69.5 kg and steady. Keep up the good work.', proposal: null }) } }] };

describe('fixture mode (the default)', () => {
  it('needs no keys and no network, writes a JSON and a Markdown report, and says it is not a real comparison', async () => {
    const { deps, written } = setup();

    const code = await runCli([], deps);

    expect(code).toBe(0);
    const paths = Object.keys(written);
    expect(paths.some((p) => p.endsWith('.json'))).toBe(true);
    expect(paths.some((p) => p.endsWith('.md'))).toBe(true);
    expect(JSON.parse(written[paths.find((p) => p.endsWith('.json'))!]).realComparison).toBe(false);
  });

  it('writes under eval/reports, a folder Git ignores', async () => {
    const { deps, written } = setup();

    await runCli([], deps);

    expect(Object.keys(written).every((p) => p.replace(/\\/g, '/').startsWith('eval/reports/'))).toBe(true);
  });
});

describe('live mode safeguards', () => {
  const scenarioFile = 'eval/private/scenarios.json';
  const files = { [scenarioFile]: JSON.stringify(RAW_FIXTURE_SCENARIOS) };

  it('makes no provider call unless paid calls are confirmed with a flag', async () => {
    const fetcher = jest.fn();
    const { deps, lines } = setup({ env: liveEnv, files, fetcher: fetcher as never });

    const code = await runCli(['--live'], deps);

    expect(code).toBe(2);
    expect(fetcher).not.toHaveBeenCalled();
    expect(lines.join('\n')).toMatch(/confirm-paid-calls/);
  });

  it('makes no provider call unless the operator attests that consent was verified independently of the file', async () => {
    const fetcher = jest.fn();
    const { deps, lines } = setup({ env: liveEnv, files, fetcher: fetcher as never });

    const code = await runCli(['--live', '--confirm-paid-calls'], deps);

    expect(code).toBe(2);
    expect(fetcher).not.toHaveBeenCalled();
    expect(lines.join('\n')).toMatch(/consent-verified/);
    expect(lines.join('\n')).toMatch(/declaration|not proof/i);
  });

  it('exits non-zero and says so when every provider call failed, and writes a report that does not claim a comparison', async () => {
    const fetcher = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const { deps, written, lines } = setup({ env: liveEnv, files, fetcher: fetcher as never });

    const code = await runCli(['--live', '--confirm-paid-calls', '--consent-verified'], deps);

    expect(code).toBe(3);
    const json = JSON.parse(written[Object.keys(written).find((p) => p.endsWith('.json'))!]);
    expect(json.status).toBe('no_successful_responses');
    expect(json.realComparison).toBe(false);
    expect(json.summary.every((s: { succeeded: number }) => s.succeeded === 0)).toBe(true);
    expect(lines.join('\n')).toMatch(/not a real comparison/i);
  });

  it('exits non-zero when a live run is incomplete', async () => {
    const fetcher = jest.fn(async (url: string) => ({ ok: true, status: 200, json: async () => goodAnswer(url) }));
    const nine = JSON.stringify(RAW_FIXTURE_SCENARIOS.slice(0, 9));
    const { deps } = setup({ env: liveEnv, files: { [scenarioFile]: nine }, fetcher: fetcher as never });

    expect(await runCli(['--live', '--confirm-paid-calls', '--consent-verified'], deps)).toBe(3);
  });

  it('refuses when the consented scenario file is missing, and says where it is expected', async () => {
    const fetcher = jest.fn();
    const { deps, lines } = setup({ env: liveEnv, fetcher: fetcher as never });

    const code = await runCli(['--live', '--confirm-paid-calls', '--consent-verified'], deps);

    expect(code).toBe(2);
    expect(fetcher).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain(scenarioFile);
  });

  it('refuses when a provider is not configured, names the missing variable and never prints a key', async () => {
    const fetcher = jest.fn();
    const { EVAL_SECOND_API_KEY: _omit, ...partial } = liveEnv;
    const { deps, lines } = setup({ env: partial, files, fetcher: fetcher as never });

    const code = await runCli(['--live', '--confirm-paid-calls', '--consent-verified'], deps);

    expect(code).toBe(2);
    expect(fetcher).not.toHaveBeenCalled();
    const output = lines.join('\n');
    expect(output).toContain('EVAL_SECOND_API_KEY');
    expect(output).not.toContain(GEMINI_KEY);
  });

  it('refuses a scenario file with identifying data before any provider call, without printing the data', async () => {
    const bad = JSON.parse(JSON.stringify(RAW_FIXTURE_SCENARIOS));
    bad[0].message = 'email me at jane.doe@example.com';
    const fetcher = jest.fn();
    const { deps, lines } = setup({ env: liveEnv, files: { [scenarioFile]: JSON.stringify(bad) }, fetcher: fetcher as never });

    const code = await runCli(['--live', '--confirm-paid-calls', '--consent-verified'], deps);

    expect(code).toBe(2);
    expect(fetcher).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('contact_detail');
    expect(lines.join('\n')).not.toContain('jane.doe');
  });

  it('runs both providers on the same scenarios through the injected fetcher and leaves keys and text out of the report and log', async () => {
    const fetcher = jest.fn(async (url: string) => ({ ok: true, status: 200, json: async () => goodAnswer(url) }));
    const { deps, written, lines } = setup({ env: liveEnv, files, fetcher: fetcher as never });

    const code = await runCli(['--live', '--confirm-paid-calls', '--consent-verified'], deps);

    expect(code).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(RAW_FIXTURE_SCENARIOS.length * 2);
    const json = JSON.parse(written[Object.keys(written).find((p) => p.endsWith('.json'))!]);
    expect(json.mode).toBe('live');
    expect(json.realComparison).toBe(true);
    expect(json.providers).toEqual(['gemini:gemini-test', 'second:second-test']);
    const everything = Object.values(written).join('\n') + lines.join('\n');
    expect(everything).not.toContain(GEMINI_KEY);
    expect(everything).not.toContain(SECOND_KEY);
    for (const scenario of RAW_FIXTURE_SCENARIOS) expect(everything).not.toContain(scenario.message);
  });

  it('uses prices only from the optional pricing file, and marks cost as an estimate', async () => {
    const fetcher = jest.fn(async (url: string) => ({ ok: true, status: 200, json: async () => goodAnswer(url) }));
    const pricing = JSON.stringify({ gemini: { currency: 'USD', inputPerMTok: 0.1, outputPerMTok: 0.4 } });
    const { deps, written } = setup({ env: liveEnv, files: { ...files, 'eval/private/pricing.json': pricing }, fetcher: fetcher as never });

    await runCli(['--live', '--confirm-paid-calls', '--consent-verified', '--pricing', 'eval/private/pricing.json'], deps);

    const json = JSON.parse(written[Object.keys(written).find((p) => p.endsWith('.json'))!]);
    const summary = (name: string) => json.summary.find((s: { provider: string }) => s.provider === name);
    expect(summary('gemini:gemini-test').costBasis).toBe('estimated');
    expect(summary('second:second-test').costBasis).toBe('unpriced');
  });
});

describe('live mode measurements', () => {
  const scenarioFile = 'eval/private/scenarios.json';
  const files = { [scenarioFile]: JSON.stringify(RAW_FIXTURE_SCENARIOS) };
  const reportOf = (written: Record<string, string>) => JSON.parse(written[Object.keys(written).find((p) => p.endsWith('.json'))!]);
  const withUsage = (url: string, extra: Record<string, unknown> = {}) => {
    const body = goodAnswer(url) as Record<string, unknown>;
    return url.includes('generativelanguage') ? { ...body, usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } } : { ...body, usage: { prompt_tokens: 100, completion_tokens: 20 }, ...extra };
  };

  it('records provider-reported tokens and one request per call, and prices from the reported tokens', async () => {
    const fetcher = jest.fn(async (url: string) => ({ ok: true, status: 200, json: async () => withUsage(url) }));
    const pricing = JSON.stringify({ gemini: { currency: 'USD', inputPerMTok: 0.1, outputPerMTok: 0.4 } });
    const { deps, written } = setup({ env: liveEnv, files: { ...files, 'eval/private/pricing.json': pricing }, fetcher: fetcher as never });

    await runCli(['--live', '--confirm-paid-calls', '--consent-verified', '--pricing', 'eval/private/pricing.json'], deps);

    const summary = (name: string) => reportOf(written).summary.find((s: { provider: string }) => s.provider === name);
    const calls = RAW_FIXTURE_SCENARIOS.length;
    expect(summary('gemini:gemini-test')).toMatchObject({ reportedInputTokens: 100 * calls, reportedOutputTokens: 20 * calls, maxUpstreamAttempts: 1, costBasis: 'reported' });
    expect(summary('second:second-test')).toMatchObject({ reportedInputTokens: 100 * calls, maxUpstreamAttempts: 1 });
  });

  it('counts a model other than the one asked for as an invalid answer, which is what a gateway fallback looks like', async () => {
    const fetcher = jest.fn(async (url: string) => ({ ok: true, status: 200, json: async () => withUsage(url, { model: 'a-fallback-model' }) }));
    const { deps, written } = setup({ env: liveEnv, files, fetcher: fetcher as never });

    const code = await runCli(['--live', '--confirm-paid-calls', '--consent-verified'], deps);

    const second = reportOf(written).summary.find((s: { provider: string }) => s.provider === 'second:second-test');
    expect(second).toMatchObject({ invalid: RAW_FIXTURE_SCENARIOS.length, answered: 0 });
    expect(code).toBe(3); // not a real comparison
  });

  it('counts a stalled gateway body as an unknown outcome and keeps the other provider\'s results', async () => {
    const fetcher = jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: () => (url.includes('generativelanguage') ? Promise.resolve(withUsage(url)) : new Promise(() => undefined)),
    }));
    const { deps, written } = setup({ env: { ...liveEnv, EVAL_PROVIDER_TIMEOUT_MS: '20' }, files: { [scenarioFile]: JSON.stringify(RAW_FIXTURE_SCENARIOS.slice(0, 3)) }, fetcher: fetcher as never });

    await runCli(['--live', '--confirm-paid-calls', '--consent-verified'], deps);

    const summary = (name: string) => reportOf(written).summary.find((s: { provider: string }) => s.provider === name);
    expect(summary('second:second-test')).toMatchObject({ unknownOutcome: 3, answered: 0 });
    expect(summary('gemini:gemini-test').answered).toBe(3);
  });
});
