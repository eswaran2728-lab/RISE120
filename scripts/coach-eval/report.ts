// Builds the scored report. It holds ids, verdicts, timings and cost only: no message, reply, prompt or error
// text exists in an EvalResult, so none can leak into the file. It refuses to compare providers that did not see
// the same scenarios, and only calls a run a real comparison when it was live, had two providers and covered
// English, Malay and Tamil.
import { COACH_LANGUAGES } from '../../supabase/functions/_shared/coach/types.ts';
import type { EvalResult } from './run.ts';
import type { ScoreRow } from './score.ts';

export interface ProviderSummary {
  provider: string;
  scenarios: number;
  errors: number;
  failures: number; // scenarios with at least one failed check
  medianLatencyMs: number | null;
  totalCost: number | null;
  costCurrency: string | null;
  costBasis: 'estimated' | 'unpriced' | 'none';
}

export interface Report {
  json: {
    mode: EvalResult['mode'];
    realComparison: boolean;
    notes: string[];
    providers: string[];
    scenarios: EvalResult['scenarios'];
    summary: ProviderSummary[];
    rows: ScoreRow[];
  };
  markdown: string;
}

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

const bad = (row: ScoreRow) => [row.safety, row.referral, row.grounding, row.proposal, row.languageCheck].some((v) => v === 'fail' || v === 'error');

function summarize(provider: string, rows: ScoreRow[]): ProviderSummary {
  const mine = rows.filter((row) => row.provider === provider);
  const priced = mine.filter((row) => row.cost !== null);
  const basis = priced.length > 0 ? 'estimated' : mine.some((row) => row.costBasis === 'unpriced') ? 'unpriced' : 'none';
  return {
    provider,
    scenarios: mine.length,
    errors: mine.filter((row) => row.status === 'error').length,
    failures: mine.filter(bad).length,
    medianLatencyMs: median(mine.map((row) => row.latencyMs)),
    totalCost: priced.length > 0 ? priced.reduce((sum, row) => sum + (row.cost ?? 0), 0) : null,
    costCurrency: priced[0]?.costCurrency ?? null,
    costBasis: basis,
  };
}

const cell = (value: string | number | null) => (value === null ? '-' : String(value));

export function buildReport(result: EvalResult): Report {
  assertEqualScenarioSets(result);

  const languages = new Set(result.scenarios.map((s) => s.language));
  const allLanguages = COACH_LANGUAGES.every((code) => languages.has(code));
  const realComparison = result.mode === 'live' && result.providers.length >= 2 && allLanguages;

  const notes: string[] = [];
  if (result.mode === 'fixture') notes.push('Fixture run: scripted fictional providers and scenarios. This is not a real comparison; it only shows the tooling works.');
  if (result.mode === 'live' && result.providers.length < 2) notes.push('Only one provider ran, so this is not a real comparison.');
  if (result.mode === 'live' && !allLanguages) notes.push('English, Malay and Tamil were not all covered, so this is not a real comparison.');
  notes.push('Token counts are estimated from character counts (about 4 characters per token) and understate Malay and Tamil; cost uses the prices you supplied, or is shown as unpriced.');
  notes.push('Language quality is a script and vocabulary check only. A native speaker must review fluency; use the reviewer notes column.');

  const summary = result.providers.map((provider) => summarize(provider, result.rows));
  const json = { mode: result.mode, realComparison, notes, providers: result.providers, scenarios: result.scenarios, summary, rows: result.rows };

  const lines: string[] = ['# Coach provider evaluation', '', `Mode: ${result.mode}. Real comparison: ${realComparison ? 'yes' : 'no'}.`, ''];
  for (const note of notes) lines.push(`- ${note}`);
  lines.push('', '## Summary', '', '| Provider | Scenarios | Errors | Scenarios with a failed check | Median latency (ms) | Cost | Basis |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const s of summary) {
    const cost = s.totalCost === null ? '-' : `${s.totalCost.toFixed(6)} ${s.costCurrency ?? ''}`.trim();
    lines.push(`| ${s.provider} | ${s.scenarios} | ${s.errors} | ${s.failures} | ${cell(s.medianLatencyMs)} | ${cost} | ${s.costBasis} |`);
  }
  lines.push('', '## Scenarios', '', '| Provider | Scenario | Language | Safety | Referral | Grounding | Proposal | Language check | Latency (ms) | Cost | Reviewer notes |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of result.rows) {
    const cost = row.cost === null ? '-' : `${row.cost.toFixed(6)} ${row.costCurrency ?? ''}`.trim();
    const verdicts = row.status === 'error' ? `error: ${row.errorKind}` : [row.safety, row.referral, row.grounding, row.proposal, row.languageCheck].join(' | ');
    lines.push(
      row.status === 'error'
        ? `| ${row.provider} | ${row.scenarioId} | ${row.language} | ${verdicts} | | | | | ${row.latencyMs} | - | ${row.reviewerNotes} |`
        : `| ${row.provider} | ${row.scenarioId} | ${row.language} | ${verdicts} | ${row.latencyMs} | ${cost} | ${row.reviewerNotes} |`
    );
  }
  return { json, markdown: lines.join('\n') + '\n' };
}
