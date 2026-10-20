import { runEvaluation, ProviderSpec } from '../run';
import { parseScenarios } from '../scenarios';
import { RAW_FIXTURE_SCENARIOS, createFixtureProviders } from '../fixtures';
import { CoachProviderError } from '../../../supabase/functions/_shared/coach/types';
import { buildReport } from '../report';
import { redact } from '../redact';

const scenarios = parseScenarios(RAW_FIXTURE_SCENARIOS);
const SECRET = 'sk-test-not-a-real-key-98765';

describe('comparison', () => {
  it('runs exactly the same scenarios, in the same order, against every provider', async () => {
    const { providers, now } = createFixtureProviders();

    const result = await runEvaluation({ scenarios, providers, now, mode: 'fixture' });

    const idsFor = (name: string) => result.rows.filter((r) => r.provider === name).map((r) => r.scenarioId);
    expect(result.providers.length).toBe(2);
    expect(idsFor(result.providers[0])).toEqual(scenarios.map((s) => s.id));
    expect(idsFor(result.providers[1])).toEqual(idsFor(result.providers[0]));
  });

  it('still records a row for a scenario whose provider call fails, so the sets stay equal', async () => {
    const failing: ProviderSpec = {
      name: 'broken',
      pricing: null,
      provider: {
        generate: async () => {
          throw new CoachProviderError('timeout', true, 'coach_provider_timeout');
        },
      },
    };
    const fine = createFixtureProviders();

    const result = await runEvaluation({ scenarios, providers: [fine.providers[0], failing], now: fine.now, mode: 'fixture' });

    const broken = result.rows.filter((r) => r.provider === 'broken');
    expect(broken).toHaveLength(scenarios.length);
    expect(new Set(broken.map((r) => r.errorKind))).toEqual(new Set(['timeout']));
  });

  it('refuses to run with duplicate provider names, which would merge two providers in the report', async () => {
    const { providers, now } = createFixtureProviders();

    await expect(runEvaluation({ scenarios, providers: [providers[0], { ...providers[1], name: providers[0].name }], now, mode: 'fixture' })).rejects.toThrow('duplicate_provider');
  });

  it('measures latency with the injected clock', async () => {
    const { providers, now } = createFixtureProviders();

    const result = await runEvaluation({ scenarios, providers, now, mode: 'fixture' });

    expect(result.rows.every((r) => Number.isFinite(r.latencyMs) && r.latencyMs >= 0)).toBe(true);
    expect(new Set(result.rows.map((r) => r.latencyMs)).size).toBeGreaterThan(1);
  });

  it('separates a better provider from a flawed one in the fixture data', async () => {
    const { providers, now } = createFixtureProviders();

    const result = await runEvaluation({ scenarios, providers, now, mode: 'fixture' });

    const failures = (name: string) =>
      result.rows.filter((r) => r.provider === name && [r.safety, r.referral, r.grounding, r.proposal, r.languageCheck].some((v) => v === 'fail' || v === 'error')).length;
    expect(failures(result.providers[0])).toBe(0);
    expect(failures(result.providers[1])).toBeGreaterThan(0);
  });

  it('records an unusable reply as an error and keeps going', async () => {
    const odd: ProviderSpec = { name: 'odd', pricing: null, provider: { generate: async () => ({ text: '', proposal: null }) } };
    const fine = createFixtureProviders();

    const result = await runEvaluation({ scenarios, providers: [fine.providers[0], odd], now: fine.now, mode: 'fixture' });

    expect(result.rows.filter((r) => r.provider === 'odd').every((r) => r.status === 'error')).toBe(true);
  });
});

describe('safe report', () => {
  it('has a row per scenario and provider with the required columns and no message or reply text', async () => {
    const { providers, now } = createFixtureProviders();
    const result = await runEvaluation({ scenarios, providers, now, mode: 'fixture' });

    const report = buildReport(result);

    expect(report.json.rows).toHaveLength(scenarios.length * 2);
    for (const column of ['scenarioId', 'language', 'safety', 'referral', 'grounding', 'proposal', 'languageCheck', 'latencyMs', 'cost', 'costBasis', 'reviewerNotes']) {
      expect(Object.keys(report.json.rows[0])).toContain(column);
    }
    const everything = JSON.stringify(report.json) + report.markdown;
    for (const scenario of scenarios) expect(everything).not.toContain(scenario.message);
    expect(everything).not.toContain('69.5 kg');
  });

  it('says plainly that fixture mode is not a real comparison', async () => {
    const { providers, now } = createFixtureProviders();
    const result = await runEvaluation({ scenarios, providers, now, mode: 'fixture' });

    const report = buildReport(result);

    expect(report.json.mode).toBe('fixture');
    expect(report.json.realComparison).toBe(false);
    expect(report.markdown).toMatch(/not a real comparison/i);
  });

  it('only calls a live run a real comparison with two providers and all three languages', async () => {
    const { providers, now } = createFixtureProviders();
    const two = await runEvaluation({ scenarios, providers, now, mode: 'live' });
    const one = await runEvaluation({ scenarios, providers: [providers[0]], now, mode: 'live' });
    const noTamil = await runEvaluation({ scenarios: scenarios.filter((s) => s.language !== 'ta'), providers, now, mode: 'live' });

    expect(buildReport(two).json.realComparison).toBe(true);
    expect(buildReport(one).json.realComparison).toBe(false);
    expect(buildReport(noTamil).json.realComparison).toBe(false);
  });

  it('refuses to build a report when the providers did not see the same scenarios', async () => {
    const { providers, now } = createFixtureProviders();
    const result = await runEvaluation({ scenarios, providers, now, mode: 'fixture' });
    const tampered = { ...result, rows: result.rows.filter((r) => !(r.provider === result.providers[1] && r.scenarioId === scenarios[0].id)) };

    expect(() => buildReport(tampered)).toThrow('unequal_scenario_sets');
  });
});

describe('secrets and private text stay out of logs and reports', () => {
  it('redacts every secret value from any text', () => {
    expect(redact(`failed with key ${SECRET} twice ${SECRET}`, [SECRET, ''])).toBe('failed with key [redacted] twice [redacted]');
    expect(redact('nothing to hide', [SECRET])).toBe('nothing to hide');
  });

  it('keeps a provider error message that contains the key, and the message text, out of the log lines and the report', async () => {
    const leaky: ProviderSpec = {
      name: 'leaky',
      pricing: null,
      provider: {
        generate: async (_context, message) => {
          throw new Error(`boom ${SECRET} while sending "${message}"`);
        },
      },
    };
    const fine = createFixtureProviders();
    const lines: string[] = [];

    const result = await runEvaluation({ scenarios, providers: [fine.providers[0], leaky], now: fine.now, mode: 'fixture', secrets: [SECRET], log: (line) => lines.push(line) });
    const report = buildReport(result);

    const everything = lines.join('\n') + JSON.stringify(report.json) + report.markdown;
    expect(everything).not.toContain(SECRET);
    for (const scenario of scenarios) expect(everything).not.toContain(scenario.message);
    expect(lines.length).toBeGreaterThan(0);
    expect(result.rows.filter((r) => r.provider === 'leaky').every((r) => r.errorKind === 'unexpected')).toBe(true);
  });
});

describe('measurements a gateway evaluation needs', () => {
  const reply = (text: string, extra: Record<string, unknown> = {}) => ({ text, proposal: null, ...extra });
  const scripted = (steps: (() => unknown)[], meter?: ProviderSpec['meter']): ProviderSpec => {
    let call = 0;
    return {
      name: 'scripted',
      pricing: { currency: 'USD', inputPerMTok: 1, outputPerMTok: 2 },
      meter,
      provider: {
        generate: async () => {
          const step = steps[call++ % steps.length];
          const value = step();
          if (value instanceof Error) throw value;
          return value as never;
        },
      },
    };
  };
  const run = (spec: ProviderSpec, count = 5) => {
    const fine = createFixtureProviders();
    return runEvaluation({ scenarios: scenarios.slice(0, count), providers: [spec], now: fine.now, mode: 'fixture' });
  };

  it('classifies every call as answered, refused, invalid, unknown outcome or a known failure', async () => {
    const spec = scripted([
      () => reply('Keep going this week'),
      () => reply('Please see a doctor', { refused: true }),
      () => new CoachProviderError('invalid', false, 'coach_provider_bad_output'),
      () => new CoachProviderError('timeout', true, 'coach_provider_timeout'),
      () => new CoachProviderError('unavailable', false, 'coach_provider_http_429'),
    ]);

    const result = await run(spec);

    expect(result.rows.map((r) => r.outcome)).toEqual(['answered', 'refused', 'invalid', 'unknown_outcome', 'failed']);
  });

  it('treats a reply the server validator rejects as invalid', async () => {
    const result = await run(scripted([() => reply('x'.repeat(5000))]), 1);

    expect(result.rows[0]).toMatchObject({ status: 'error', errorKind: 'invalid_reply', outcome: 'invalid' });
  });

  it('records the provider-reported tokens and how many requests Rise120 sent, and prices from the reported tokens', async () => {
    const meter = { take: jest.fn(() => ({ usage: { inputTokens: 1000, outputTokens: 500 }, attempts: 1 })) };

    const result = await run(scripted([() => reply('Keep going this week')], meter), 1);

    expect(result.rows[0]).toMatchObject({ reportedInputTokens: 1000, reportedOutputTokens: 500, upstreamAttempts: 1, costBasis: 'reported' });
    expect(result.rows[0].cost).toBeCloseTo((1000 * 1 + 500 * 2) / 1_000_000, 10);
  });

  it('still records reported tokens and attempts for a call that failed, because a failed call can be billed', async () => {
    const meter = { take: jest.fn(() => ({ usage: { inputTokens: 300, outputTokens: 0 }, attempts: 1 })) };

    const result = await run(scripted([() => new CoachProviderError('timeout', true, 'coach_provider_timeout')], meter), 1);

    expect(result.rows[0]).toMatchObject({ status: 'error', outcome: 'unknown_outcome', reportedInputTokens: 300, upstreamAttempts: 1, cost: null });
  });

  it('falls back to the estimate, and says so, when the provider reports no usage', async () => {
    const meter = { take: jest.fn(() => ({ usage: null, attempts: 1 })) };

    const result = await run(scripted([() => reply('Keep going this week')], meter), 1);

    expect(result.rows[0]).toMatchObject({ reportedInputTokens: null, reportedOutputTokens: null, costBasis: 'estimated' });
  });

  it('takes the meter reading for each call separately', async () => {
    const readings = [{ usage: { inputTokens: 10, outputTokens: 1 }, attempts: 1 }, { usage: { inputTokens: 20, outputTokens: 2 }, attempts: 2 }];
    let i = 0;

    const result = await run(scripted([() => reply('Keep going this week')], { take: () => readings[i++] }), 2);

    expect(result.rows.map((r) => [r.reportedInputTokens, r.upstreamAttempts])).toEqual([[10, 1], [20, 2]]);
  });

  it('reports the outcome mix, the reported tokens and the most requests any call needed, and flags more than one request per call', async () => {
    const meter = { take: jest.fn().mockReturnValueOnce({ usage: { inputTokens: 100, outputTokens: 10 }, attempts: 1 }).mockReturnValue({ usage: { inputTokens: 100, outputTokens: 10 }, attempts: 2 }) };
    const result = await run(scripted([() => reply('Keep going this week'), () => new CoachProviderError('timeout', true, 'coach_provider_timeout')], meter), 4);

    const report = buildReport(result);

    expect(report.json.summary[0]).toMatchObject({ answered: 2, unknownOutcome: 2, refused: 0, invalid: 0, knownFailures: 0, reportedInputTokens: 400, reportedOutputTokens: 40, maxUpstreamAttempts: 2 });
    expect(report.json.notes.join(' ')).toMatch(/more than one request/i);
  });

  it('keeps every secret and all provider text out of the report, whatever a provider throws', async () => {
    const spec = scripted([() => new Error(`socket closed ${SECRET} knee pain`)]);
    const result = await runEvaluation({ scenarios: scenarios.slice(0, 2), providers: [spec], now: createFixtureProviders().now, mode: 'fixture', secrets: [SECRET], log: () => undefined });

    const report = buildReport(result);

    expect(JSON.stringify(report.json)).not.toContain(SECRET);
    expect(JSON.stringify(report.json)).not.toContain('knee');
    expect(report.markdown).not.toContain('knee');
  });
});
