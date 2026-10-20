// The command behind `npm run eval:coach`. Fixture mode (default) needs no keys and no network. Live mode makes
// paid provider calls, so it needs --live AND --confirm-paid-calls, a consented scenario file, and every provider
// variable set; anything missing stops it before a single request. All I/O comes in through CliDeps so the tests
// run it without files, keys or network.
import { createGeminiProvider } from '../../supabase/functions/_shared/coach/gemini.ts';
import { RAW_FIXTURE_SCENARIOS, createFixtureProviders } from './fixtures.ts';
import { createOpenAiCompatibleProvider } from './openai.ts';
import { buildReport } from './report.ts';
import { CallMeter, ProviderSpec, runEvaluation } from './run.ts';
import { ScenarioRejected, parseScenarios } from './scenarios.ts';
import type { Pricing } from './score.ts';

type Fetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface CliDeps {
  env: Record<string, string | undefined>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  log(line: string): void;
  now(): number;
  fetcher?: Fetcher;
  stamp?: () => string;
}

const DEFAULT_SCENARIOS = 'eval/private/scenarios.json';
const REPORT_DIR = 'eval/reports';
const REQUIRED_ENV = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'EVAL_SECOND_BASE_URL', 'EVAL_SECOND_API_KEY', 'EVAL_SECOND_MODEL'];
const SECRET_ENV = ['GEMINI_API_KEY', 'EVAL_SECOND_API_KEY'];

// Counts the requests Rise120 sends and keeps the token counts the provider reports, for one provider. The run reads
// and clears it after every call.
function createMeter(base: Fetcher | undefined) {
  let attempts = 0;
  let usage: { inputTokens: number; outputTokens: number } | null = null;
  const fetcher: Fetcher = (url, init) => {
    attempts += 1;
    return (base ?? ((u, i) => fetch(u, i)))(url, init);
  };
  const meter: CallMeter = {
    take() {
      const reading = { usage, attempts };
      attempts = 0;
      usage = null;
      return reading;
    },
  };
  return { fetcher, meter, onUsage: (reported: { inputTokens: number; outputTokens: number }) => (usage = reported) };
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const isPricing = (value: unknown): value is Pricing =>
  typeof value === 'object' && value !== null && typeof (value as Pricing).currency === 'string' && typeof (value as Pricing).inputPerMTok === 'number' && typeof (value as Pricing).outputPerMTok === 'number';

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const live = argv.includes('--live');
  const secrets = SECRET_ENV.map((name) => deps.env[name] ?? '').filter(Boolean);
  const stamp = (deps.stamp ?? (() => new Date().toISOString().replace(/[:.]/g, '-')))();

  let scenariosRaw: unknown = RAW_FIXTURE_SCENARIOS;
  let providers: ProviderSpec[];
  let now = deps.now;

  if (!live) {
    const fixture = createFixtureProviders();
    providers = fixture.providers;
    now = fixture.now;
  } else {
    if (!argv.includes('--confirm-paid-calls')) {
      deps.log('Live mode makes paid provider calls. Re-run with --confirm-paid-calls to proceed.');
      return 2;
    }
    if (!argv.includes('--consent-verified')) {
      deps.log('The consent flag inside the scenario file is only a declaration, not proof. Verify each member\'s consent for this use independently, then re-run with --consent-verified.');
      return 2;
    }
    const scenarioPath = option(argv, '--scenarios') ?? DEFAULT_SCENARIOS;
    try {
      scenariosRaw = JSON.parse(await deps.readFile(scenarioPath));
    } catch {
      deps.log(`Cannot read the consented scenario file at ${scenarioPath} (it must exist, be valid JSON and stay out of Git).`);
      return 2;
    }
    const missing = REQUIRED_ENV.filter((name) => !deps.env[name]);
    if (missing.length > 0) {
      deps.log(`Missing provider settings: ${missing.join(', ')}.`);
      return 2;
    }

    let prices: { gemini?: unknown; second?: unknown } = {};
    const pricingPath = option(argv, '--pricing');
    if (pricingPath) {
      try {
        prices = JSON.parse(await deps.readFile(pricingPath));
      } catch {
        deps.log(`Cannot read the pricing file at ${pricingPath}.`);
        return 2;
      }
    }
    const env = deps.env as Record<string, string>;
    // Optional: a shorter end-to-end deadline for a gateway test (milliseconds); the coach's own limit otherwise.
    const timeout = Number(env.EVAL_PROVIDER_TIMEOUT_MS);
    const timeoutMs = Number.isInteger(timeout) && timeout > 0 ? timeout : undefined;
    const first = createMeter(deps.fetcher);
    const second = createMeter(deps.fetcher);
    providers = [
      {
        name: `gemini:${env.GEMINI_MODEL}`,
        provider: createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, fetcher: first.fetcher, onUsage: first.onUsage, timeoutMs }),
        pricing: isPricing(prices.gemini) ? prices.gemini : null,
        meter: first.meter,
      },
      {
        name: `second:${env.EVAL_SECOND_MODEL}`,
        provider: createOpenAiCompatibleProvider({ baseUrl: env.EVAL_SECOND_BASE_URL, apiKey: env.EVAL_SECOND_API_KEY, model: env.EVAL_SECOND_MODEL, fetcher: second.fetcher, onUsage: second.onUsage, timeoutMs }),
        pricing: isPricing(prices.second) ? prices.second : null,
        meter: second.meter,
      },
    ];
  }

  let scenarios;
  try {
    scenarios = parseScenarios(scenariosRaw);
  } catch (error) {
    if (!(error instanceof ScenarioRejected)) throw error;
    deps.log('The scenario file was rejected, so nothing was sent to any provider:');
    for (const problem of error.problems) deps.log(`  ${problem.scenarioId}: ${problem.code} at ${problem.path}`);
    return 2;
  }

  const result = await runEvaluation({ scenarios, providers, now, mode: live ? 'live' : 'fixture', secrets, log: deps.log });
  const report = buildReport(result);

  await deps.mkdir(REPORT_DIR);
  const base = `${REPORT_DIR}/coach-eval-${result.mode}-${stamp}`;
  await deps.writeFile(`${base}.json`, JSON.stringify(report.json, null, 2));
  await deps.writeFile(`${base}.md`, report.markdown);
  deps.log(`Report written to ${base}.md and ${base}.json (untracked). Status: ${report.json.status}. Real comparison: ${report.json.realComparison ? 'yes' : 'no'}.`);
  // A live run that is not a real comparison (failed calls, missing languages, wrong scenario count) must not look
  // like success to a script or a person skimming the terminal.
  if (live && !report.json.realComparison) {
    deps.log('This live run is not a real comparison; see the notes in the report.');
    return 3;
  }
  return 0;
}
