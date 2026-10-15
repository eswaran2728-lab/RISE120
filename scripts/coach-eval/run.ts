// Runs every scenario against every provider through the one CoachProvider contract. A provider that fails on a
// scenario still gets a row, so every provider always has the same scenario set. Only ids, codes and timings are
// logged: never a prompt, a message, a reply or an error message (a provider error can echo a key or the input).
import { CoachProvider, CoachProviderError } from '../../supabase/functions/_shared/coach/types.ts';
import { redact } from './redact.ts';
import { EvalScenario, toContext } from './scenarios.ts';
import { Outcome, Pricing, ScoreRow, scoreOutcome } from './score.ts';

export type EvalMode = 'fixture' | 'live';

export interface ProviderSpec {
  name: string;
  provider: CoachProvider;
  pricing: Pricing | null;
}

export interface EvalResult {
  mode: EvalMode;
  providers: string[];
  scenarios: { id: string; language: string }[];
  rows: ScoreRow[];
}

export interface RunOptions {
  scenarios: EvalScenario[];
  providers: ProviderSpec[];
  now: () => number;
  mode: EvalMode;
  secrets?: string[];
  log?: (line: string) => void;
}

export async function runEvaluation(options: RunOptions): Promise<EvalResult> {
  const names = options.providers.map((p) => p.name);
  if (new Set(names).size !== names.length) throw new Error('duplicate_provider');
  const secrets = options.secrets ?? [];
  const log = (line: string) => options.log?.(redact(line, secrets));

  const rows: ScoreRow[] = [];
  for (const spec of options.providers) {
    for (const scenario of options.scenarios) {
      const started = options.now();
      let outcome: Outcome;
      try {
        const reply = await spec.provider.generate(toContext(scenario), scenario.message);
        outcome = { reply, errorKind: null, latencyMs: options.now() - started };
      } catch (error) {
        // Only the kind of failure is kept. The message is dropped on purpose.
        const errorKind = error instanceof CoachProviderError ? error.kind : 'unexpected';
        outcome = { reply: null, errorKind, latencyMs: options.now() - started };
      }
      const row = scoreOutcome(scenario, outcome, spec.pricing, spec.name);
      rows.push(row);
      log(`${spec.name} ${scenario.id} ${row.status}${row.errorKind ? ` (${row.errorKind})` : ''} ${row.latencyMs}ms`);
    }
  }

  return { mode: options.mode, providers: names, scenarios: options.scenarios.map((s) => ({ id: s.id, language: s.language })), rows };
}
