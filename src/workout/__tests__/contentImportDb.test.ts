import { createImportDb } from '../../../scripts/training-content/importDb';

type Call = { table: string; op: string; args: unknown[] };

// A stand-in shaped like the supabase-js client: records which tables are read and written.
function fakeClient(rows: Record<string, unknown[]>) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      const record = (op: string) => (...args: unknown[]) => {
        calls.push({ table, op, args });
        return query;
      };
      query.select = record('select');
      query.insert = record('insert');
      query.update = record('update');
      query.delete = record('delete');
      query.eq = record('eq');
      query.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows[table] ?? [], error: null });
      return query;
    },
  };
  return { client, calls };
}

describe('createImportDb', () => {
  it('reads the three catalogue tables and the ids of public.exercises, and nothing else', async () => {
    const { client, calls } = fakeClient({ exercise_versions: [{ id: 'a' }], session_templates: [], exercise_links: [{ catalogue_id: 'a', exercise_id: 'u' }], exercises: [{ id: 'u1' }, { id: 'u2' }] });

    const state = await createImportDb(client as never).read();

    expect(state.exerciseIds).toEqual(['u1', 'u2']);
    expect(state.links).toEqual([{ catalogue_id: 'a', exercise_id: 'u' }]);
    expect(calls.every((c) => c.op === 'select')).toBe(true);
    expect([...new Set(calls.map((c) => c.table))].sort()).toEqual(['exercise_links', 'exercise_versions', 'exercises', 'session_templates']);
  });

  it('writes only to the catalogue tables, and refuses any other table', async () => {
    const { client, calls } = fakeClient({});
    const db = createImportDb(client as never);

    await db.insert('exercise_versions', { id: 'a', version: 1 });
    await db.update('session_templates', { id: 's', version: 1 }, { status: 'published' });
    await db.remove('exercise_links', { catalogue_id: 'a' });

    expect(calls.filter((c) => c.op !== 'select' && c.op !== 'eq').map((c) => `${c.op} ${c.table}`)).toEqual(['insert exercise_versions', 'update session_templates', 'delete exercise_links']);
    await expect(db.insert('workout_logs' as never, {})).rejects.toThrow(/table/i);
    await expect(db.remove('exercises' as never, { id: 'x' })).rejects.toThrow(/table/i);
  });

  it('surfaces a database error instead of continuing', async () => {
    const failing = { from: () => ({ insert: () => ({ then: (resolve: (v: unknown) => unknown) => resolve({ error: { message: 'boom' } }) }) }) };

    await expect(createImportDb(failing as never).insert('exercise_versions', {})).rejects.toThrow('boom');
  });
});
