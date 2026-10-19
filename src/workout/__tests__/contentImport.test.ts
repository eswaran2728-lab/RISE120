import fs from 'fs';
import path from 'path';
import {
  applyImport,
  buildImportPlan,
  DEV_PROJECT_REF,
  renderPlan,
  type ExistingState,
  type ImportDb,
  type ImportInput,
  type Mapping,
  type Row,
} from '../../../scripts/training-content/import';
import type { ExerciseVersion, SessionTemplate } from '../catalogue';

// SYNTHETIC fixtures only. Nothing here is real Rise120 content, a real reviewer, or a real database row.
const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'Fixture Reviewer', role: 'Fixture role', reviewedOn: '2000-01-01' };
const media = { kind: 'video' as const, source: 'Fixture studio', licence: 'Fixture licence' };
const ex = (id: string, over: Partial<ExerciseVersion> = {}): ExerciseVersion => ({
  id, version: 1, pattern: 'squat', equipment: 'none', name: L(id), cues: [L('one'), L('two')], regressions: [], alternatives: [], media, reviewer, status: 'published', ...over,
});
const sess = (over: Partial<SessionTemplate> = {}): SessionTemplate => ({
  id: 's1', version: 1, goal: 'recomp', level: 'beginner', minutes: 10, location: 'home', dayType: 'training', exercises: [{ exerciseId: 'a', sets: 2, reps: 10 }, { exerciseId: 'b', sets: 2, reps: 10 }], reviewer, status: 'published', ...over,
});
const UA = '11111111-1111-4111-8111-111111111111';
const UB = '22222222-2222-4222-8222-222222222222';
const UC = '33333333-3333-4333-8333-333333333333';
const mapping = (over: Partial<Mapping> = {}): Mapping => ({ reviewedBy: reviewer, links: { a: UA, b: UB }, ...over });
const input = (over: Partial<ImportInput> = {}): ImportInput => ({
  exercises: [ex('a', { alternatives: ['b'] }), ex('b', { alternatives: ['a'] })],
  sessions: [sess()],
  mapping: mapping(),
  ...over,
});
const emptyState = (over: Partial<ExistingState> = {}): ExistingState => ({ exerciseVersions: [], sessionTemplates: [], links: [], exerciseIds: [UA, UB, UC], ...over });
const codes = (result: ReturnType<typeof buildImportPlan>) => result.refusals.map((r) => `${r.code}:${r.id}`);

describe('buildImportPlan: what it refuses', () => {
  it('accepts a fully approved, fully mapped pack and proposes only inserts the first time', () => {
    const result = buildImportPlan(input(), emptyState());

    expect(result.refusals).toEqual([]);
    expect(result.plan!.ops.map((o) => `${o.kind} ${o.table} ${o.key}`)).toEqual([
      'insert exercise_versions a@1', 'insert exercise_versions b@1', 'insert session_templates s1@1', 'insert exercise_links a', 'insert exercise_links b',
    ]);
  });

  it.each(['draft', 'in_review'] as const)('refuses an exercise or session that is %s, and proposes nothing at all', (status) => {
    const result = buildImportPlan(input({ exercises: [ex('a', { alternatives: ['b'], status }), ex('b', { alternatives: ['a'] })], sessions: [sess({ status })] }), emptyState());

    expect(codes(result)).toEqual(expect.arrayContaining(['not_published:a', 'not_published:s1']));
    expect(result.plan).toBeNull();
  });

  it('refuses missing or incomplete review evidence and missing media, source or licence', () => {
    const result = buildImportPlan(
      input({
        exercises: [
          ex('a', { alternatives: ['b'], reviewer: null }),
          ex('b', { alternatives: ['a'], media: null }),
          ex('c', { alternatives: ['a'], media: { kind: 'video', source: 'x', licence: ' ' } }),
          ex('d', { alternatives: ['a'], reviewer: { name: '', role: 'r', reviewedOn: '2000-01-01' } }),
        ],
        sessions: [sess({ reviewer: null })],
        mapping: mapping({ links: { a: UA, b: UB, c: UC, d: UC } }),
      }),
      emptyState()
    );

    expect(codes(result)).toEqual(expect.arrayContaining(['missing_reviewer:a', 'missing_media:b', 'missing_licence:c', 'missing_reviewer:d', 'missing_reviewer:s1']));
    expect(result.plan).toBeNull();
  });

  it('refuses invalid alternatives: unknown, a different movement pattern, and no home substitute', () => {
    const unknown = buildImportPlan(input({ exercises: [ex('a', { alternatives: ['ghost'] }), ex('b', { alternatives: ['a'] })] }), emptyState());
    const mismatch = buildImportPlan(input({ exercises: [ex('a', { alternatives: ['b'] }), ex('b', { pattern: 'push', alternatives: ['a'] })] }), emptyState());
    const noHome = buildImportPlan(input({ exercises: [ex('a', { alternatives: [] }), ex('b', { alternatives: ['a'] })] }), emptyState());

    expect(codes(unknown)).toContain('catalogue_invalid:a');
    expect(codes(mismatch).some((c) => c.startsWith('catalogue_invalid:'))).toBe(true);
    expect(codes(noHome)).toContain('catalogue_invalid:a');
  });

  it('refuses sessions that reference an exercise that is missing, not in this import, or whose length does not fit', () => {
    const missing = buildImportPlan(input({ sessions: [sess({ exercises: [{ exerciseId: 'a', sets: 2, reps: 10 }, { exerciseId: 'ghost', sets: 2, reps: 10 }] })] }), emptyState());
    const tooShort = buildImportPlan(input({ sessions: [sess({ minutes: 30 })] }), emptyState());

    expect(codes(missing)).toContain('catalogue_invalid:s1');
    expect(codes(tooShort)).toContain('catalogue_invalid:s1');
  });
});

describe('buildImportPlan: the reviewed mapping to public.exercises', () => {
  it('refuses an exercise that has no mapping entry, and never falls back to matching by name', () => {
    const result = buildImportPlan(input({ mapping: mapping({ links: { a: UA } }) }), emptyState({ exerciseNames: { [UB]: 'b' } } as Partial<ExistingState>));

    expect(codes(result)).toContain('link_missing:b');
    expect(result.plan).toBeNull();
  });

  it('refuses a mapping that has not been reviewed', () => {
    expect(codes(buildImportPlan(input({ mapping: { links: { a: UA, b: UB } } as unknown as Mapping }), emptyState()))).toContain('mapping_unreviewed:mapping');
    expect(codes(buildImportPlan(input({ mapping: mapping({ reviewedBy: { name: 'x', role: '', reviewedOn: '' } }) }), emptyState()))).toContain('mapping_unreviewed:mapping');
  });

  it('refuses an entry for an exercise that is not in the pack, a target that is not a uuid, or one that is not in public.exercises', () => {
    const extra = buildImportPlan(input({ mapping: mapping({ links: { a: UA, b: UB, ghost: UC } }) }), emptyState());
    const notUuid = buildImportPlan(input({ mapping: mapping({ links: { a: 'Goblet squat', b: UB } }) }), emptyState());
    const absent = buildImportPlan(input({ mapping: mapping({ links: { a: UA, b: '44444444-4444-4444-8444-444444444444' } }) }), emptyState());

    expect(codes(extra)).toContain('link_unknown_exercise:ghost');
    expect(codes(notUuid)).toContain('link_target_invalid:a');
    expect(codes(absent)).toContain('link_target_unknown:b');
  });

  it('refuses two catalogue exercises mapped to the same logged-set exercise (ambiguous history)', () => {
    const result = buildImportPlan(input({ mapping: mapping({ links: { a: UA, b: UA } }) }), emptyState());

    expect(codes(result)).toEqual(expect.arrayContaining(['link_shared_target:a', 'link_shared_target:b']));
  });

  it('refuses to re-point an existing link, since logged sets use it', () => {
    const result = buildImportPlan(input(), emptyState({ links: [{ catalogue_id: 'a', exercise_id: UC }] }));

    expect(codes(result)).toEqual(['link_conflict:a']);
  });

  it('refuses a session whose exercise has no link', () => {
    const result = buildImportPlan(input({ mapping: mapping({ links: { a: UA } }) }), emptyState());

    expect(codes(result)).toEqual(expect.arrayContaining(['link_missing:b', 'session_exercise_unlinked:s1']));
  });
});

describe('buildImportPlan: idempotent and safe with what is already there', () => {
  const applied = (): ExistingState => {
    const first = buildImportPlan(input(), emptyState()).plan!;
    return emptyState({
      exerciseVersions: first.ops.filter((o) => o.table === 'exercise_versions').map((o) => o.row),
      sessionTemplates: first.ops.filter((o) => o.table === 'session_templates').map((o) => o.row),
      links: first.ops.filter((o) => o.table === 'exercise_links').map((o) => o.row as { catalogue_id: string; exercise_id: string }),
    });
  };

  it('proposes nothing when everything is already imported', () => {
    const result = buildImportPlan(input(), applied());

    expect(result.refusals).toEqual([]);
    expect(result.plan!.ops).toEqual([]);
    expect(result.plan!.unchanged).toBe(5);
  });

  it('turns an existing unpublished row into an update, never a duplicate insert', () => {
    const state = applied();
    state.exerciseVersions = state.exerciseVersions.map((r) => (r.id === 'a' ? { ...r, status: 'draft', reviewer: null, media: null } : r));

    const result = buildImportPlan(input(), state);

    expect(result.plan!.ops.map((o) => `${o.kind} ${o.table} ${o.key}`)).toEqual(['update exercise_versions a@1']);
  });

  it('refuses to change a version that is already published: a new version number is required', () => {
    const changed = input({ exercises: [ex('a', { alternatives: ['b'], cues: [L('different'), L('cues')] }), ex('b', { alternatives: ['a'] })] });

    expect(codes(buildImportPlan(changed, applied()))).toEqual(['version_conflict:a']);
  });

  it('gives the same plan hash for the same input and a different one when anything changes', () => {
    const one = buildImportPlan(input(), emptyState()).plan!;
    const two = buildImportPlan(input(), emptyState()).plan!;
    const other = buildImportPlan(input({ sessions: [sess({ exercises: [{ exerciseId: 'a', sets: 3, reps: 10 }, { exerciseId: 'b', sets: 2, reps: 10 }] })] }), emptyState()).plan!;

    expect(one.hash).toBe(two.hash);
    expect(other.hash).not.toBe(one.hash);
  });
});

describe('renderPlan (the dry run)', () => {
  it('shows every proposed insert, update and link with its exact row, and the hash to approve', () => {
    const plan = buildImportPlan(input(), emptyState()).plan!;

    const text = renderPlan(plan).join('\n');

    expect(text).toContain('INSERT exercise_versions a@1');
    expect(text).toContain('INSERT session_templates s1@1');
    expect(text).toContain(`LINK a -> ${UA}`);
    expect(text).toContain(plan.hash);
    expect(text).toContain('"reviewedOn": "2000-01-01"');
    expect(text).toMatch(/dry run/i);
  });

  it('says plainly when there is nothing to do', () => {
    const plan = buildImportPlan(input(), emptyState()).plan!;
    const done = buildImportPlan(input(), emptyState({
      exerciseVersions: plan.ops.filter((o) => o.table === 'exercise_versions').map((o) => o.row),
      sessionTemplates: plan.ops.filter((o) => o.table === 'session_templates').map((o) => o.row),
      links: plan.ops.filter((o) => o.table === 'exercise_links').map((o) => o.row as { catalogue_id: string; exercise_id: string }),
    })).plan!;

    expect(renderPlan(done).join('\n')).toMatch(/nothing to import/i);
  });
});

// An in-memory stand-in for the database that records every write.
function fakeDb(start: ExistingState, failAtWrite = Infinity) {
  const state: ExistingState = JSON.parse(JSON.stringify(start));
  const tables = { workout_logs: [{ id: 'log-1', exercise_id: UA, reps: 10 }], exercises: [{ id: UA, name: 'Squat' }] };
  const writes: string[] = [];
  const tableOf = (t: string) => (t === 'exercise_versions' ? state.exerciseVersions : t === 'session_templates' ? state.sessionTemplates : state.links) as Row[];
  const matches = (t: string, row: Row, key: Row) => (t === 'exercise_links' ? row.catalogue_id === key.catalogue_id : row.id === key.id && row.version === key.version);
  const guard = (what: string) => {
    writes.push(what);
    if (writes.length === failAtWrite) throw new Error('simulated write failure');
  };
  const db: ImportDb = {
    read: async () => JSON.parse(JSON.stringify(state)),
    insert: async (t, row) => { guard(`insert ${t}`); tableOf(t).push(JSON.parse(JSON.stringify(row))); },
    update: async (t, key, patch) => { guard(`update ${t}`); const r = tableOf(t).find((x) => matches(t, x, key))!; Object.assign(r, JSON.parse(JSON.stringify(patch))); },
    remove: async (t, key) => { const list = tableOf(t); const i = list.findIndex((x) => matches(t, x, key)); if (i >= 0) list.splice(i, 1); },
  };
  return { db, state, tables, writes };
}
const guard = (over: Record<string, unknown> = {}) => ({ projectRef: DEV_PROJECT_REF, linkedProjectRef: DEV_PROJECT_REF, supabaseUrl: `https://${DEV_PROJECT_REF}.supabase.co`, confirmProject: DEV_PROJECT_REF, ...over });

describe('applyImport', () => {
  it('writes exactly the approved plan, then is a no-op the second time (idempotent)', async () => {
    const { db, state, writes } = fakeDb(emptyState());
    const hash = buildImportPlan(input(), emptyState()).plan!.hash;

    const first = await applyImport(input(), db, { ...guard(), planHash: hash });
    const second = await applyImport(input(), db, { ...guard(), planHash: first.hash });

    expect(first.applied).toBe(5);
    expect(state.exerciseVersions).toHaveLength(2);
    expect(state.sessionTemplates).toHaveLength(1);
    expect(state.links).toEqual([{ catalogue_id: 'a', exercise_id: UA }, { catalogue_id: 'b', exercise_id: UB }]);
    expect(second.applied).toBe(0);
    expect(writes).toHaveLength(5);
  });

  it('touches only the three catalogue tables: logged sets and the exercises table are never written', async () => {
    const { db, tables, writes } = fakeDb(emptyState());
    const before = JSON.stringify(tables);

    await applyImport(input(), db, { ...guard(), planHash: buildImportPlan(input(), emptyState()).plan!.hash });

    expect(JSON.stringify(tables)).toBe(before);
    expect(writes.every((w) => /exercise_versions|session_templates|exercise_links/.test(w))).toBe(true);
  });

  it.each([
    ['a different project ref', { projectRef: 'someotherprojectref' }],
    ['a different linked project', { linkedProjectRef: 'someotherprojectref' }],
    ['a different database url', { supabaseUrl: 'https://someotherprojectref.supabase.co' }],
    ['no confirmation of the project', { confirmProject: undefined }],
    ['the wrong confirmation', { confirmProject: 'yes' }],
  ])('refuses before writing anything when given %s', async (_name, over) => {
    const { db, writes } = fakeDb(emptyState());

    await expect(applyImport(input(), db, { ...guard(over), planHash: buildImportPlan(input(), emptyState()).plan!.hash })).rejects.toThrow(/project/i);
    expect(writes).toEqual([]);
  });

  it('refuses a plan hash that is not the one shown in the dry run, or none', async () => {
    const { db, writes } = fakeDb(emptyState());

    await expect(applyImport(input(), db, { ...guard(), planHash: 'deadbeef' })).rejects.toThrow(/hash/i);
    await expect(applyImport(input(), db, { ...guard() } as never)).rejects.toThrow(/hash/i);
    expect(writes).toEqual([]);
  });

  it('refuses to apply anything when the input has a refusal, such as a draft', async () => {
    const { db, writes } = fakeDb(emptyState());
    const drafts = input({ exercises: [ex('a', { alternatives: ['b'], status: 'draft' }), ex('b', { alternatives: ['a'] })] });

    await expect(applyImport(drafts, db, { ...guard(), planHash: 'x' })).rejects.toThrow(/refus/i);
    expect(writes).toEqual([]);
  });

  it('rolls back every earlier write when one fails, leaving the database as it was', async () => {
    const start = emptyState({ exerciseVersions: [{ id: 'a', version: 1, status: 'draft', reviewer: null, media: null, pattern: 'squat', equipment: 'none', name: L('a'), cues: [], regressions: [], alternatives: [] }] });
    const { db, state } = fakeDb(start, 4);
    const before = JSON.stringify(state);
    const hash = buildImportPlan(input(), start).plan!.hash;

    await expect(applyImport(input(), db, { ...guard(), planHash: hash })).rejects.toThrow(/simulated write failure/);

    expect(JSON.stringify(state)).toBe(before);
  });

  it('notices that the database changed since the dry run and refuses the stale plan', async () => {
    const { db, writes } = fakeDb(emptyState());
    const hash = buildImportPlan(input(), emptyState()).plan!.hash;
    await db.insert('exercise_links', { catalogue_id: 'a', exercise_id: UA });
    writes.length = 0;

    await expect(applyImport(input(), db, { ...guard(), planHash: hash })).rejects.toThrow(/hash/i);
    expect(writes).toEqual([]);
  });
});

describe('the real draft pack', () => {
  it('is refused outright: nothing in content/ is approved, so nothing could be imported', () => {
    const read = (dir: string) => fs.readdirSync(path.join(__dirname, '../../../', dir)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(__dirname, '../../../', dir, n), 'utf8')));
    const real: ImportInput = { exercises: read('content/exercises'), sessions: read('content/sessions'), mapping: mapping({ links: {} }) };

    const result = buildImportPlan(real, emptyState());

    expect(result.plan).toBeNull();
    expect(result.refusals.filter((r) => r.code === 'not_published')).toHaveLength(real.exercises.length + real.sessions.length);
  });
});
