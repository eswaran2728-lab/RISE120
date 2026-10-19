import fs from 'fs';
import path from 'path';
import { createAdmin, createTestClient, createTestUser, publishableKey, supabaseUrl } from './helpers';
import { applyImport, buildImportPlan, DEV_PROJECT_REF, type ImportInput, type Plan } from '../../scripts/training-content/import';
import { createImportDb } from '../../scripts/training-content/importDb';
import type { ExerciseVersion, SessionTemplate } from '../../src/workout/catalogue';

jest.setTimeout(180000);

// SYNTHETIC approved fixtures only, written to and removed from the DEVELOPMENT project. They never touch the real
// draft pack. The import is one database transaction: every write, or none.
const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'Fixture Reviewer', role: 'Fixture role', reviewedOn: '2000-01-01' };
const media = { kind: 'video' as const, source: 'Fixture studio', licence: 'Fixture licence' };

describe('atomic guided-content import (live, synthetic fixtures)', () => {
  const admin = createAdmin();
  const db = createImportDb(admin as never);
  const suffix = `${Date.now()}`;
  const ids = { a: `imp-${suffix}-a`, b: `imp-${suffix}-b`, s: `imp-${suffix}-s` };
  let seed: string[] = [];

  const exercise = (id: string, other: string): ExerciseVersion => ({ id, version: 1, pattern: 'squat', equipment: 'none', name: L(id), cues: [L('one'), L('two')], regressions: [], alternatives: [other], media, reviewer, status: 'published' });
  const session: SessionTemplate = { id: ids.s, version: 1, goal: 'recomp', level: 'beginner', minutes: 10, location: 'home', dayType: 'training', exercises: [{ exerciseId: ids.a, sets: 2, reps: 10 }, { exerciseId: ids.b, sets: 2, reps: 10 }], reviewer, status: 'published' };
  const input = (): ImportInput => ({ exercises: [exercise(ids.a, ids.b), exercise(ids.b, ids.a)], sessions: [session], mapping: { reviewedBy: reviewer, links: { [ids.a]: seed[0], [ids.b]: seed[1] } } });
  const plan = async (): Promise<Plan> => {
    const result = buildImportPlan(input(), await db.read());
    expect(result.refusals).toEqual([]);
    return result.plan!;
  };
  const rowsOf = async () => ({
    exercises: (await admin.from('exercise_versions').select('id, published_at, status').in('id', [ids.a, ids.b])).data ?? [],
    sessions: (await admin.from('session_templates').select('id, published_at, status').eq('id', ids.s)).data ?? [],
    links: (await admin.from('exercise_links').select('catalogue_id').in('catalogue_id', [ids.a, ids.b])).data ?? [],
  });
  const clean = async () => {
    await admin.from('exercise_links').delete().in('catalogue_id', [ids.a, ids.b]);
    await admin.from('session_templates').delete().eq('id', ids.s);
    await admin.from('exercise_versions').delete().in('id', [ids.a, ids.b]);
  };

  beforeAll(async () => {
    seed = ((await admin.from('exercises').select('id').order('name')).data ?? []).map((r: { id: string }) => r.id);
    expect(seed.length).toBeGreaterThanOrEqual(2);
    await clean();
  });
  afterEach(clean);
  afterAll(clean);

  it('writes every row in one call, with one database-time published_at for the whole import', async () => {
    const before = Date.now();

    const result = await db.applyPlan(await plan());

    expect(result).toEqual({ inserted: 5, updated: 0, skipped: 0 });
    const rows = await rowsOf();
    expect(rows.exercises).toHaveLength(2);
    expect(rows.sessions).toHaveLength(1);
    expect(rows.links).toHaveLength(2);
    const stamps = new Set([...rows.exercises, ...rows.sessions].map((r: { published_at: string }) => r.published_at));
    expect(stamps.size).toBe(1); // one transaction, one database time
    const stamp = new Date([...stamps][0]).getTime();
    expect(stamp).toBeGreaterThan(before - 10 * 60 * 1000); // database time, within clock skew
    expect(stamp).toBeLessThan(Date.now() + 10 * 60 * 1000);
  });

  it('is a no-op when replayed: nothing is rewritten, and published_at does not move', async () => {
    const first = await plan();
    await db.applyPlan(first);
    const before = await rowsOf();

    const again = await db.applyPlan(first); // the same approved plan, sent again

    expect(again).toEqual({ inserted: 0, updated: 0, skipped: 5 });
    expect(await rowsOf()).toEqual(before);
  });

  it('rolls back every write when one step fails inside the transaction', async () => {
    const good = await plan();
    const broken: Plan = { ...good, ops: good.ops.map((op) => (op.table === 'exercise_links' && op.key === ids.b ? { ...op, row: { ...op.row, exercise_id: '99999999-9999-4999-8999-999999999999' } } : op)) }; // no such exercise: a foreign-key failure on the last write

    await expect(db.applyPlan(broken)).rejects.toThrow();

    const rows = await rowsOf();
    expect(rows.exercises).toEqual([]);
    expect(rows.sessions).toEqual([]);
    expect(rows.links).toEqual([]);
  });

  it('refuses a plan the database has moved on from after the dry run, and writes nothing', async () => {
    const stale = await plan(); // planned against a database without these rows
    expect((await admin.from('exercise_versions').insert({ id: ids.a, version: 1, pattern: 'squat', equipment: 'none', name: L('changed meanwhile'), cues: [], regressions: [], alternatives: [], status: 'draft' })).error).toBeNull();

    await expect(db.applyPlan(stale)).rejects.toThrow(/PLAN_STALE/);

    const rows = await rowsOf();
    expect(rows.exercises.map((r: { id: string }) => r.id)).toEqual([ids.a]); // only the other writers row
    expect(rows.exercises[0].status).toBe('draft');
    expect(rows.sessions).toEqual([]);
    expect(rows.links).toEqual([]);
  });

  it('refuses an update whose starting row was changed after the dry run', async () => {
    const draft = { id: ids.a, version: 1, pattern: 'squat', equipment: 'none', name: L(ids.a), cues: [], regressions: [], alternatives: [ids.b], media: null, reviewer: null, status: 'draft' };
    const other = { ...draft, id: ids.b, alternatives: [ids.a] };
    expect((await admin.from('exercise_versions').insert([draft, other])).error).toBeNull();
    const approved = await plan(); // update both drafts, insert the session and links
    expect(approved.ops.filter((o) => o.kind === 'update')).toHaveLength(2);
    await admin.from('exercise_versions').update({ name: L('edited after the dry run') }).eq('id', ids.b);

    await expect(db.applyPlan(approved)).rejects.toThrow(/PLAN_STALE/);

    const rows = await rowsOf();
    expect(rows.exercises.every((r: { status: string }) => r.status === 'draft')).toBe(true); // the first update was rolled back too
    expect(rows.sessions).toEqual([]);
  });

  it('sets published_at when a draft first becomes published, and keeps one it already has', async () => {
    const base = { version: 1, pattern: 'squat', equipment: 'none', cues: [], regressions: [], media: null, reviewer: null, status: 'draft' };
    expect((await admin.from('exercise_versions').insert([{ ...base, id: ids.a, name: L(ids.a), alternatives: [ids.b] }, { ...base, id: ids.b, name: L(ids.b), alternatives: [ids.a], published_at: '2020-01-01T00:00:00Z' }])).error).toBeNull();

    await db.applyPlan(await plan());

    const rows = await rowsOf();
    const byId = new Map(rows.exercises.map((r: { id: string; published_at: string }) => [r.id, r.published_at]));
    expect(byId.get(ids.a)).not.toBeNull();
    expect(new Date(byId.get(ids.a)!).getFullYear()).toBeGreaterThanOrEqual(2026);
    expect(new Date(byId.get(ids.b)!).toISOString()).toBe('2020-01-01T00:00:00.000Z');
  });

  it('only ever writes the three catalogue tables, and never changes the exercises table', async () => {
    const before = (await admin.from('exercises').select('id, name')).data;

    await db.applyPlan(await plan());

    expect((await admin.from('exercises').select('id, name')).data).toEqual(before);
  });

  it.each([
    ['an unknown table', (ops: unknown[]) => [{ kind: 'insert', table: 'workout_logs', row: { id: 'x' } }, ...ops]],
    ['an unpublished row', (ops: { row: Record<string, unknown> }[]) => ops.map((o, i) => (i === 0 ? { ...o, row: { ...o.row, status: 'draft' } } : o))],
    ['an unknown kind', (ops: unknown[]) => [{ kind: 'delete', table: 'exercise_links', row: { catalogue_id: 'x' } }, ...ops]],
  ])('refuses a plan containing %s, writing nothing', async (_name, tamper) => {
    const good = await plan();
    const tampered = tamper(good.ops as never) as { kind: string; table: string; row: unknown; previous?: unknown }[];
    const ops = tampered.map((o) => ({ kind: o.kind, table: o.table, row: o.row, previous: o.previous }));

    const { error } = await admin.rpc('import_guided_catalogue', { p_ops: ops, p_plan_hash: good.hash });

    expect(error?.message).toMatch(/INVALID_PLAN/);
    expect((await rowsOf()).exercises).toEqual([]);
  });

  it('can be called by the service role only, never by a member or anyone signed out', async () => {
    const good = await plan();
    const call = { p_ops: good.ops.map((o) => ({ kind: o.kind, table: o.table, row: o.row })), p_plan_hash: good.hash };
    const user = await createTestUser(admin, 'importer');
    try {
      expect((await user.client.rpc('import_guided_catalogue', call)).error).not.toBeNull();
      expect((await createTestClient(publishableKey).rpc('import_guided_catalogue', call)).error).not.toBeNull();
      expect((await rowsOf()).exercises).toEqual([]);
    } finally {
      await admin.auth.admin.deleteUser(user.id);
    }
  });

  it('works end to end through applyImport with the development-project guard', async () => {
    const linked = fs.readFileSync(path.resolve(__dirname, '../.temp/project-ref'), 'utf8').trim();
    const dry = await plan();

    const result = await applyImport(input(), db, { projectRef: DEV_PROJECT_REF, linkedProjectRef: linked, supabaseUrl, confirmProject: DEV_PROJECT_REF, planHash: dry.hash });
    const replay = await applyImport(input(), db, { projectRef: DEV_PROJECT_REF, linkedProjectRef: linked, supabaseUrl, confirmProject: DEV_PROJECT_REF, planHash: dry.hash });

    expect(result.applied).toBe(5);
    expect(replay.applied).toBe(0);
  });
});
