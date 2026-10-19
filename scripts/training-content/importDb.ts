// The supabase-js side of the import: reads the three catalogue tables (and only the ids of public.exercises) and
// writes only to those three tables. Any other table name is refused, so this adapter cannot touch logged sets or the
// exercises table even by mistake. The client is created by the caller with the development project's service key.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExistingState, ImportDb, Row, Table } from './import.ts';

const WRITABLE: Table[] = ['exercise_versions', 'session_templates', 'exercise_links'];

function assertWritable(table: string): asserts table is Table {
  if (!WRITABLE.includes(table as Table)) throw new Error(`Refusing to write to table "${table}": the import may only write ${WRITABLE.join(', ')}.`);
}

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
    async insert(table, row) {
      assertWritable(table);
      check((await client.from(table).insert(row)).error);
    },
    async update(table, key, patch) {
      assertWritable(table);
      let query = client.from(table).update(patch);
      for (const [column, value] of Object.entries(key)) query = query.eq(column, value as never);
      check((await query).error);
    },
    async remove(table, key) {
      assertWritable(table);
      let query = client.from(table).delete();
      for (const [column, value] of Object.entries(key)) query = query.eq(column, value as never);
      check((await query).error);
    },
  };
}
