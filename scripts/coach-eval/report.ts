// Builds the scored report. It holds ids, verdicts, timings and cost only: no message, reply, prompt or error
// text exists in an EvalResult, so none can leak into the file. It refuses to compare providers that did not see
// the same scenarios, and it counts attempts, successful answers and failures separately: a run where calls
// failed is never described as a successful comparison.
import type { EvalResult } from './run.ts';
import type { ScoreRow } from './score.ts';

type LanguageCounts = { attempted: number; succeeded: number; failed: number };

export interface ProviderSummary {
  provider: string;
  attempted: number;
  succeeded: number; // a usable answer came back (a safe refusal counts)
  failed: number; // timeout, HTTP error or unusable reply
  byLanguage: Record<'en' | 'ms' | 'ta', LanguageCounts>;
  scenariosWithFailedCheck: number; // answered, but at least one scored check failed
  medianLatencyMs: number | null; // successful calls only
  failedMedianLatencyMs: number | null;
  totalCost: number | null; // successful calls only
  costCurrency: string | null;
  costBasis: 'reported' | 'estimated' | 'unpriced' | 'none';
  answered: number;
  refused: number;
  invalid: number; // an answer that failed Rise120's own validation, or came from a different model than asked for
  unknownOutcome: number; // may have been processed and billed; never retried automatically
  knownFailures: number;
  reportedInputTokens: number | null; // provider-reported, all calls including failed ones; null when none was reported
  reportedOutputTokens: number | null;
  maxUpstreamAttempts: number | null; // most requests Rise120 sent for one call (a gateway may start more upstream)
}

export type ReportStatus = 'fixture' | 'no_successful_responses' | 'incomplete' | 'real';

export interface Report {
  json: {
    mode: EvalResult['mode'];
    status: ReportStatus;
    realComparison: boolean;
    notes: string[];
    reviews: { nativeSpeaker: 'not_recorded' };
    providers: string[];
    scenarios: EvalResult['scenarios'];
    summary: ProviderSummary[];
    rows: ScoreRow[];
  };
  markdown: string;
}

// The approved evaluation set: ten scenarios spanning English, Malay and Tamil (at least three of each).
export const REQUIRED_SCENARIOS = 10;
export const MIN_PER_LANGUAGE = 3;

const LANGS = ['en', 'ms', 'ta'] as const;

export function assertEqualScenarioSets(result: EvalResult): void {
  const expected = result.scenarios.map((s) => s.id);
  for (const provider of result.providers) {
    const ids = result.rows.filter((row) => row.provider === provider).map((row) => row.scenarioId);
    if (ids.length !== expected.length || ids.some((id, index) => id !== expected[index])) throw new Error('unequal_scenario_sets');
  }
}

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const failedCheck = (row: ScoreRow) => [row.safety, row.referral, row.grounding, row.proposal, row.languageCheck].some((v) => v === 'fail');

const reportedTotal = (values: (number | null)[]) => {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? present.reduce((sum, v) => sum + v, 0) : null;
};

function summarize(provider: string, rows: ScoreRow[]): ProviderSummary {
  const mine = rows.filter((row) => row.provider === provider);
  const attempts = mine.map((row) => row.upstreamAttempts).filter((v): v is number => v !== null);
  const ok = mine.filter((row) => row.status === 'ok');
  const bad = mine.filter((row) => row.status === 'error');
  const priced = ok.filter((row) => row.cost !== null);
  const counts = (language: string): LanguageCounts => {
    const inLanguage = mine.filter((row) => row.language === language);
    const succeeded = inLanguage.filter((row) => row.status === 'ok').length;
    return { attempted: inLanguage.length, succeeded, failed: inLanguage.length - succeeded };
  };
  return {
    provider,
    attempted: mine.length,
    succeeded: ok.length,
    failed: bad.length,
    byLanguage: { en: counts('en'), ms: counts('ms'), ta: counts('ta') },
    scenariosWithFailedCheck: ok.filter(failedCheck).length,
    medianLatencyMs: median(ok.map((row) => row.latencyMs)),
    failedMedianLatencyMs: median(bad.map((row) => row.latencyMs)),
    totalCost: priced.length > 0 ? priced.reduce((sum, row) => sum + (row.cost ?? 0), 0) : null,
    costCurrency: priced[0]?.costCurrency ?? null,
    costBasis: priced.length > 0 ? (priced.every((row) => row.costBasis === 'reported') ? 'reported' : 'estimated') : ok.some((row) => row.costBasis === 'unpriced') ? 'unpriced' : 'none',
    answered: mine.filter((row) => row.outcome === 'answered').length,
    refused: mine.filter((row) => row.outcome === 'refused').length,
    invalid: mine.filter((row) => row.outcome === 'invalid').length,
    unknownOutcome: mine.filter((row) => row.outcome === 'unknown_outcome').length,
    knownFailures: mine.filter((row) => row.outcome === 'failed').length,
    reportedInputTokens: reportedTotal(mine.map((row) => row.reportedInputTokens)),
    reportedOutputTokens: reportedTotal(mine.map((row) => row.reportedOutputTokens)),
    maxUpstreamAttempts: attempts.length > 0 ? Math.max(...attempts) : null,
  };
}

const cell = (value: string | number | null) => (value === null ? '-' : String(value));

export function buildReport(result: EvalResult): Report {
  assertEqualScenarioSets(result);

  const summary = result.providers.map((provider) => summarize(provider, result.rows));
  const perLanguage: Record<string, number> = Object.fromEntries(LANGS.map((code) => [code, result.scenarios.filter((s) => s.language === code).length]));
  const coverageOk = result.scenarios.length === REQUIRED_SCENARIOS && LANGS.every((code) => perLanguage[code] >= MIN_PER_LANGUAGE);
  // A provider must have answered at least once in every language, or the comparison says nothing about it there.
  const everyProviderAnsweredEverywhere = summary.length >= 2 && summary.every((s) => LANGS.every((code) => s.byLanguage[code].succeeded > 0));
  const totalSucceeded = summary.reduce((sum, s) => sum + s.succeeded, 0);

  const realComparison = result.mode === 'live' && coverageOk && everyProviderAnsweredEverywhere;
  const status: ReportStatus = result.mode === 'fixture' ? 'fixture' : realComparison ? 'real' : totalSucceeded === 0 ? 'no_successful_responses' : 'incomplete';

  const notes: string[] = [];
  if (result.mode === 'fixture') notes.push('Fixture run: scripted fictional providers and scenarios. This is not a real comparison; it only shows the tooling works.');
  if (result.mode === 'live') {
    if (status === 'no_successful_responses') notes.push('No successful responses: no provider returned a usable answer, so this is not a real comparison.');
    if (summary.length < 2) notes.push('Only one provider ran, so this is not a real comparison.');
    if (!coverageOk) {
      notes.push(
        `The approved set is ${REQUIRED_SCENARIOS} scenarios with at least ${MIN_PER_LANGUAGE} each in English, Malay and Tamil; this run had ${result.scenarios.length} (en ${perLanguage.en}, ms ${perLanguage.ms}, ta ${perLanguage.ta}), so it is not a real comparison.`
      );
    }
    for (const s of summary) {
      const silent = LANGS.filter((code) => s.byLanguage[code].succeeded === 0);
      if (silent.length > 0 && totalSucceeded > 0) notes.push(`${s.provider} gave no successful response in ${silent.join(', ')}, so this is not a real comparison.`);
      if (s.failed > 0) notes.push(`${s.provider}: ${s.failed} failed call${s.failed === 1 ? '' : 's'} of ${s.attempted} attempted (${s.succeeded} succeeded).`);
    }
  }
  for (const s of summary) {
    if (s.maxUpstreamAttempts !== null && s.maxUpstreamAttempts > 1) notes.push(`${s.provider}: Rise120 sent more than one request for a single call (at most ${s.maxUpstreamAttempts}); every attempt can be billed.`);
    if (s.unknownOutcome > 0) notes.push(`${s.provider}: ${s.unknownOutcome} call${s.unknownOutcome === 1 ? '' : 's'} with an unknown outcome (possibly billed, never retried automatically).`);
  }
  notes.push('Native-speaker review of Malay and Tamil replies has not been recorded by this tool. The language check is a script and vocabulary rule only; use the reviewer notes column.');
  notes.push('Consent in the scenario file is a declaration typed into the file, not proof. It must be verified independently of this tool before real member data is used.');
  notes.push('Latency is one call per scenario (no repeats) and noisy. Median latency counts successful calls only; failed calls are reported separately.');
  notes.push('Cost uses the token counts the provider reported when it reported them (basis: reported); otherwise tokens are estimated from character counts (about 4 characters per token), which understates Malay and Tamil (basis: estimated). Either way it is computed from the prices you supplied over successful calls, or shown as unpriced. It is not a bill, and a gateway can send more requests upstream than Rise120 sees.');

  const json = {
    mode: result.mode,
    status,
    realComparison,
    notes,
    reviews: { nativeSpeaker: 'not_recorded' as const },
    providers: result.providers,
    scenarios: result.scenarios,
    summary,
    rows: result.rows,
  };

  const lines: string[] = [
    '# Coach provider evaluation',
    '',
    `Mode: ${result.mode}. Status: ${status}. Real comparison: ${realComparison ? 'yes' : 'no (this is not a real comparison)'}.`,
    '',
  ];
  for (const note of notes) lines.push(`- ${note}`);
  lines.push(
    '',
    '## Summary',
    '',
    '| Provider | Attempted | Succeeded | Failed | Answered with a failed check | en ok/attempted | ms ok/attempted | ta ok/attempted | Median latency, successful (ms) | Median latency, failed (ms) | Cost | Basis | Outcomes (answered/refused/invalid/unknown/failed) | Reported tokens in/out | Max requests per call |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  );
  for (const s of summary) {
    const cost = s.totalCost === null ? '-' : `${s.totalCost.toFixed(6)} ${s.costCurrency ?? ''}`.trim();
    const lang = (code: (typeof LANGS)[number]) => `${s.byLanguage[code].succeeded}/${s.byLanguage[code].attempted}`;
    lines.push(
      `| ${s.provider} | ${s.attempted} | ${s.succeeded} | ${s.failed} | ${s.scenariosWithFailedCheck} | ${lang('en')} | ${lang('ms')} | ${lang('ta')} | ${cell(s.medianLatencyMs)} | ${cell(s.failedMedianLatencyMs)} | ${cost} | ${s.costBasis} | ${s.answered}/${s.refused}/${s.invalid}/${s.unknownOutcome}/${s.knownFailures} | ${cell(s.reportedInputTokens)}/${cell(s.reportedOutputTokens)} | ${cell(s.maxUpstreamAttempts)} |`
    );
  }
  lines.push(
    '',
    '## Scenarios',
    '',
    '| Provider | Scenario | Language | Safety | Referral | Grounding | Proposal | Language check | Latency (ms) | Cost | Reviewer notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  );
  for (const row of result.rows) {
    const cost = row.cost === null ? '-' : `${row.cost.toFixed(6)} ${row.costCurrency ?? ''}`.trim();
    lines.push(
      row.status === 'error'
        ? `| ${row.provider} | ${row.scenarioId} | ${row.language} | error: ${row.errorKind} | | | | | ${row.latencyMs} | - | ${row.reviewerNotes} |`
        : `| ${row.provider} | ${row.scenarioId} | ${row.language} | ${[row.safety, row.referral, row.grounding, row.proposal, row.languageCheck].join(' | ')} | ${row.latencyMs} | ${cost} | ${row.reviewerNotes} |`
    );
  }
  return { json, markdown: lines.join('\n') + '\n' };
}
