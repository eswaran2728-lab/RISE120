// The supabase-js side of the import. It reads the three catalogue tables (and only the ids of public.exercises) and
// applies a plan with ONE call to the service-role-only database function import_guided_catalogue, which runs the
// whole plan in a single transaction. There is no method that writes a row on its own, so this adapter cannot leave a
// partial publication or touch logged sets. The client is created by the caller with the development project's key.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApplyResult, ExistingState, ImportDb, Plan, Row } from './import.ts';

function check(error: { message: string } | null | undefined): void {
  if (error) throw new Error(error.message);
}

export function createImportDb(client: SupabaseClient): ImportDb {
  const select = async (table: string, columns: string): Promise<Row[]> => {
    const { data, error } = await client.from(table).select(columns);
    check(error);
    return (data ?? []) as unknown as Row[];
  };
  return {
    async read(): Promise<ExistingState> {
      const [exerciseVersions, sessionTemplates, links, exercises] = await Promise.all([
        select('exercise_versions', 'id, version, pattern, equipment, name, cues, regressions, alternatives, media, reviewer, status'),
        select('session_templates', 'id, version, goal, level, minutes, location, day_type, exercises, reviewer, status'),
        select('exercise_links', 'catalogue_id, exercise_id'),
        select('exercises', 'id'),
      ]);
      return { exerciseVersions, sessionTemplates, links: links as ExistingState['links'], exerciseIds: exercises.map((r) => String(r.id)) };
    },
    async applyPlan(plan: Plan): Promise<ApplyResult> {
      const { data, error } = await client.rpc('import_guided_catalogue', {
        p_ops: plan.ops.map(({ kind, table, row, previous }) => ({ kind, table, row, previous })),
        p_plan_hash: plan.hash,
      });
      check(error);
      const answer = data as Partial<ApplyResult> | null;
      if (!answer || typeof answer.inserted !== 'number' || typeof answer.updated !== 'number' || typeof answer.skipped !== 'number') throw new Error('The database gave an answer the import could not read.');
      return { inserted: answer.inserted, updated: answer.updated, skipped: answer.skipped };
    },
  };
}
