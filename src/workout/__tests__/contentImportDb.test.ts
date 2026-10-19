import { createImportDb } from '../../../scripts/training-content/importDb';

type Call = { table: string; op: string; args: unknown[] };

// A stand-in shaped like the supabase-js client: records which tables are read and which functions are called.
function fakeClient(rows: Record<string, unknown[]>, rpcAnswer: { data?: unknown; error?: { message: string } | null } = { data: { inserted: 5, updated: 0, skipped: 0 }, error: null }) {
  const calls: Call[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
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
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcAnswer);
    },
  };
  return { client, calls, rpcCalls };
}

const plan = { ops: [{ kind: 'insert' as const, table: 'exercise_versions' as const, key: 'a@1', row: { id: 'a', version: 1 } }], unchanged: 0, hash: 'f'.repeat(64) };

describe('createImportDb', () => {
  it('reads the three catalogue tables and the ids of public.exercises, and never writes with table calls', async () => {
    const { client, calls } = fakeClient({ exercise_versions: [{ id: 'a' }], session_templates: [], exercise_links: [{ catalogue_id: 'a', exercise_id: 'u' }], exercises: [{ id: 'u1' }, { id: 'u2' }] });

    const state = await createImportDb(client as never).read();

    expect(state.exerciseIds).toEqual(['u1', 'u2']);
    expect(state.links).toEqual([{ catalogue_id: 'a', exercise_id: 'u' }]);
    expect(calls.every((c) => c.op === 'select')).toBe(true);
    expect([...new Set(calls.map((c) => c.table))].sort()).toEqual(['exercise_links', 'exercise_versions', 'exercises', 'session_templates']);
  });

  it('applies a plan with exactly ONE call to the single import function, and makes no other write', async () => {
    const { client, calls, rpcCalls } = fakeClient({});

    const result = await createImportDb(client as never).applyPlan(plan);

    expect(rpcCalls).toEqual([{ name: 'import_guided_catalogue', args: { p_ops: [{ kind: 'insert', table: 'exercise_versions', row: { id: 'a', version: 1 }, previous: undefined }], p_plan_hash: plan.hash } }]);
    expect(calls).toEqual([]);
    expect(result).toEqual({ inserted: 5, updated: 0, skipped: 0 });
  });

  it('has no row-by-row write methods at all', () => {
    const db = createImportDb(fakeClient({}).client as never);

    expect(Object.keys(db).sort()).toEqual(['applyPlan', 'read']);
  });

  it('surfaces a database error instead of continuing', async () => {
    const { client } = fakeClient({}, { data: null, error: { message: 'PLAN_STALE: changed' } });

    await expect(createImportDb(client as never).applyPlan(plan)).rejects.toThrow('PLAN_STALE');
  });

  it('refuses an answer it cannot read', async () => {
    const { client } = fakeClient({}, { data: { inserted: 'many' }, error: null });

    await expect(createImportDb(client as never).applyPlan(plan)).rejects.toThrow(/answer/i);
  });
});
