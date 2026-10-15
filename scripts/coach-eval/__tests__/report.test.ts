import { runEvaluation, ProviderSpec } from '../run';
import { parseScenarios } from '../scenarios';
import { RAW_FIXTURE_SCENARIOS, createFixtureProviders } from '../fixtures';
import { buildReport } from '../report';
import { CoachProviderError } from '../../../supabase/functions/_shared/coach/types';

const scenarios = parseScenarios(RAW_FIXTURE_SCENARIOS);

const failing = (name: string, answersOnlyIn?: string): ProviderSpec => {
  const good = createFixtureProviders().providers[0].provider;
  return {
    name,
    pricing: null,
    provider: {
      async generate(context, message) {
        if (answersOnlyIn && context.language === answersOnlyIn) return good.generate(context, message);
        throw new CoachProviderError('unavailable', false, 'coach_provider_http_503');
      },
    },
  };
};

async function live(providers: ProviderSpec[], set = scenarios) {
  const { now } = createFixtureProviders();
  return buildReport(await runEvaluation({ scenarios: set, providers, now, mode: 'live' }));
}

describe('a live report counts attempts, successes and failures separately', () => {
  it('does not claim a real comparison when every call of every provider failed, in all three languages', async () => {
    const report = await live([failing('a'), failing('b')]);

    expect(report.json.realComparison).toBe(false);
    expect(report.json.status).toBe('no_successful_responses');
    for (const s of report.json.summary) {
      expect(s.attempted).toBe(scenarios.length);
      expect(s.succeeded).toBe(0);
      expect(s.failed).toBe(scenarios.length);
    }
    expect(report.markdown).toMatch(/not a real comparison/i);
    expect(report.markdown).toMatch(/no provider returned a usable answer|no successful/i);
  });

  it('does not claim a real comparison when only one provider answered', async () => {
    const { providers } = createFixtureProviders();

    const report = await live([providers[0], failing('b')]);

    expect(report.json.realComparison).toBe(false);
    expect(report.json.status).toBe('incomplete');
  });

  it('names the language a provider never answered in, and does not call it a real comparison', async () => {
    const { providers } = createFixtureProviders();

    const report = await live([providers[0], failing('b', 'en')]); // b only answers English

    expect(report.json.realComparison).toBe(false);
    const b = report.json.summary.find((s) => s.provider === 'b')!;
    expect(b.byLanguage.en.succeeded).toBeGreaterThan(0);
    expect(b.byLanguage.ms.succeeded).toBe(0);
    expect(b.byLanguage.ta.succeeded).toBe(0);
    expect(report.json.notes.join(' ')).toMatch(/b.*(ms|ta)|(ms|ta).*b/);
  });

  it('is a real comparison only with ten scenarios, at least three per language, and an answer from both providers in every language', async () => {
    const { providers } = createFixtureProviders();

    const ok = await live(providers);
    const nine = await live(providers, scenarios.slice(0, 9));
    const noTamil = await live(providers, scenarios.filter((s) => s.language !== 'ta'));
    const oneProvider = await live([providers[0]]);

    expect(scenarios).toHaveLength(10);
    expect(ok.json.realComparison).toBe(true);
    expect(ok.json.status).toBe('real');
    expect(nine.json.realComparison).toBe(false);
    expect(noTamil.json.realComparison).toBe(false);
    expect(oneProvider.json.realComparison).toBe(false);
  });

  it('stays a real comparison when a provider fails a few calls, but reports every failure', async () => {
    const { providers } = createFixtureProviders(); // fixture-b times out on ta-adjust

    const report = await live(providers);

    expect(report.json.realComparison).toBe(true);
    const b = report.json.summary.find((s) => s.provider === 'fixture-b')!;
    expect(b.failed).toBe(1);
    expect(b.succeeded).toBe(scenarios.length - 1);
    expect(report.json.notes.join(' ')).toMatch(/1 failed call/);
  });

  it('never reports a fixture run as real', async () => {
    const { providers, now } = createFixtureProviders();

    const report = buildReport(await runEvaluation({ scenarios, providers, now, mode: 'fixture' }));

    expect(report.json.realComparison).toBe(false);
    expect(report.json.status).toBe('fixture');
  });
});

describe('honest reporting', () => {
  it('says native-speaker review has not been recorded, and that consent is a declaration', async () => {
    const { providers } = createFixtureProviders();

    const report = await live(providers);

    expect(report.json.reviews.nativeSpeaker).toBe('not_recorded');
    expect(report.json.notes.join(' ')).toMatch(/native.speaker/i);
    expect(report.json.notes.join(' ')).toMatch(/consent.*(declared|declaration)/i);
  });

  it('takes median latency from successful calls only and keeps failed-call latency separate', async () => {
    const { providers, now } = createFixtureProviders();
    const slowFailure: ProviderSpec = {
      name: 'slow',
      pricing: null,
      provider: {
        async generate(context, message) {
          if (context.language !== 'en') throw new CoachProviderError('timeout', true, 'coach_provider_timeout');
          return providers[0].provider.generate(context, message);
        },
      },
    };
    const result = await runEvaluation({ scenarios, providers: [providers[0], slowFailure], now, mode: 'live' });
    // Make the failed calls look very slow.
    result.rows.filter((r) => r.provider === 'slow' && r.status === 'error').forEach((r) => (r.latencyMs = 20000));

    const slow = buildReport(result).json.summary.find((s) => s.provider === 'slow')!;

    expect(slow.medianLatencyMs).toBeLessThan(1000);
    expect(slow.failedMedianLatencyMs).toBe(20000);
  });

  it('adds up estimated cost over successful calls only and keeps unpriced providers unpriced', async () => {
    const { providers, now } = createFixtureProviders();

    const report = buildReport(await runEvaluation({ scenarios, providers, now, mode: 'live' }));

    const [a, b] = report.json.summary;
    expect(a.costBasis).toBe('estimated');
    expect(a.totalCost).toBeGreaterThan(0);
    expect(b.costBasis).toBe('unpriced');
    expect(b.totalCost).toBeNull();
    expect(report.json.notes.join(' ')).toMatch(/estimate/i);
  });

  it('shows attempted, succeeded and failed in the markdown summary', async () => {
    const report = await live([failing('a'), failing('b')]);

    expect(report.markdown).toMatch(/Attempted/);
    expect(report.markdown).toMatch(/Succeeded/);
    expect(report.markdown).toMatch(/Failed/);
  });
});
