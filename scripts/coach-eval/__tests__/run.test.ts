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
