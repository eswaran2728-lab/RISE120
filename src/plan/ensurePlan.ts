import type { LocalDate } from '../sync/types';
import type { PlanBundle } from './planData';

export interface EnsurePlanDeps {
  load: () => Promise<PlanBundle | null>;
  generate: (startDate: LocalDate) => Promise<void>;
  today: () => LocalDate;
}

// Returns the user's plan, generating it first if they do not have one yet. The server call is
// idempotent, so retrying after a failure or a double tap never makes a second plan.
export async function ensurePlan(deps: EnsurePlanDeps): Promise<{ bundle: PlanBundle; created: boolean }> {
  const existing = await deps.load();
  if (existing) return { bundle: existing, created: false };

  await deps.generate(deps.today());
  const bundle = await deps.load();
  if (!bundle) throw new Error('Plan not found after generation');
  return { bundle, created: true };
}
