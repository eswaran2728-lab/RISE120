// Imports APPROVED guided-workout content into the Rise120 development database. Dry-run first:
//   buildImportPlan(...)  decides what would be written, or why nothing may be, and writes nothing;
//   renderPlan(...)       shows exactly what that is, with a hash that identifies it;
//   applyImport(...)      sends only that exact plan, only to the confirmed development project, as one atomic call.
// It refuses drafts and anything without review and media evidence, and it never matches an exercise to the logged-set
// table (public.exercises) by name: every link must come from an explicitly reviewed mapping. It writes only
// exercise_versions, session_templates and exercise_links, and never touches logged sets or public.exercises.
// Applying is ONE database call (a single transaction in the database): every write or none, rechecked against the
// current rows inside that transaction, so a crash or a concurrent change cannot leave a partial publication.
import { createHash } from 'node:crypto';
import { CatalogueInput, ExerciseVersion, SessionTemplate, validateCatalogue } from '../../src/workout/catalogue.ts';

export const DEV_PROJECT_REF = 'kozskxoiyrzrokjmcqeo';

export type Row = Record<string, unknown>;
export type Table = 'exercise_versions' | 'session_templates' | 'exercise_links';

export interface Mapping {
  reviewedBy: { name: string; role: string; reviewedOn: string };
  links: Record<string, string>; // catalogue exercise id -> public.exercises.id (uuid), chosen by a person
}

export interface ImportInput extends CatalogueInput {
  mapping: Mapping;
}

export interface ExistingState {
  exerciseVersions: Row[];
  sessionTemplates: Row[];
  links: { catalogue_id: string; exercise_id: string }[];
  exerciseIds: string[] | null; // ids present in public.exercises; null when not checked (offline dry run)
}

export interface Refusal {
  code: string;
  id: string;
}

export interface Op {
  kind: 'insert' | 'update';
  table: Table;
  key: string;
  row: Row;
  previous?: Row;
}

export interface Plan {
  ops: Op[];
  unchanged: number;
  hash: string;
}

export interface ApplyResult {
  inserted: number;
  updated: number;
  skipped: number;
}

// The database offers reading and ONE atomic apply. There is deliberately no way to write a row at a time.
export interface ImportDb {
  read(): Promise<ExistingState>;
  applyPlan(plan: Plan): Promise<ApplyResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const filled = (text: unknown) => typeof text === 'string' && text.trim().length > 0;
const reviewerComplete = (r: { name?: string; role?: string; reviewedOn?: string } | null | undefined) => !!r && filled(r.name) && filled(r.role) && filled(r.reviewedOn);

const sortKeys = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(sortKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Row).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, sortKeys(v)])) : value;
const canonical = (value: unknown) => JSON.stringify(sortKeys(value));

const exerciseRow = (e: ExerciseVersion): Row => ({
  id: e.id, version: e.version, pattern: e.pattern, equipment: e.equipment, name: e.name, cues: e.cues, regressions: e.regressions, alternatives: e.alternatives, media: e.media, reviewer: e.reviewer, status: 'published',
});
const sessionRow = (s: SessionTemplate): Row => ({
  id: s.id, version: s.version, goal: s.goal, level: s.level, minutes: s.minutes, location: s.location, day_type: s.dayType, exercises: s.exercises, reviewer: s.reviewer, status: 'published',
});

// The columns we would write, compared with what is stored (extra stored columns such as timestamps are ignored).
const sameContent = (proposed: Row, stored: Row) => canonical(proposed) === canonical(Object.fromEntries(Object.keys(proposed).map((k) => [k, stored[k]])));

export function buildImportPlan(input: ImportInput, existing: ExistingState): { refusals: Refusal[]; plan: Plan | null } {
  const refusals: Refusal[] = [];
  const refuse = (code: string, id: string) => {
    if (!refusals.some((r) => r.code === code && r.id === id)) refusals.push({ code, id });
  };

  // 1. Only approved content: published, with review and media evidence.
  for (const e of input.exercises) {
    if (e.status !== 'published') refuse('not_published', e.id);
    else {
      if (!reviewerComplete(e.reviewer)) refuse('missing_reviewer', e.id);
      if (!e.media) refuse('missing_media', e.id);
      else if (!filled(e.media.source) || !filled(e.media.licence)) refuse('missing_licence', e.id);
    }
  }
  for (const s of input.sessions) {
    if (s.status !== 'published') refuse('not_published', s.id);
    else if (!reviewerComplete(s.reviewer)) refuse('missing_reviewer', s.id);
  }

  // 2. Whole-catalogue rules: names, cues, alternatives, session references, lengths.
  const alreadyReported = new Set(['missing_reviewer', 'missing_media', 'missing_licence']);
  for (const error of validateCatalogue({ exercises: input.exercises, sessions: input.sessions }).errors) {
    if (!alreadyReported.has(error.code)) refuse('catalogue_invalid', error.id);
  }

  // 3. The reviewed mapping to public.exercises. Names are never used.
  const { mapping } = input;
  if (!mapping || !reviewerComplete(mapping.reviewedBy)) refuse('mapping_unreviewed', 'mapping');
  const links = mapping?.links ?? {};
  const known = new Set(input.exercises.map((e) => e.id));
  for (const id of Object.keys(links)) if (!known.has(id)) refuse('link_unknown_exercise', id);
  const byTarget = new Map<string, string[]>();
  for (const e of input.exercises) {
    const target = links[e.id];
    if (target === undefined) {
      refuse('link_missing', e.id);
      continue;
    }
    if (typeof target !== 'string' || !UUID.test(target)) {
      refuse('link_target_invalid', e.id);
      continue;
    }
    if (existing.exerciseIds && !existing.exerciseIds.includes(target)) refuse('link_target_unknown', e.id);
    byTarget.set(target, [...(byTarget.get(target) ?? []), e.id]);
    const stored = existing.links.find((l) => l.catalogue_id === e.id);
    if (stored && stored.exercise_id !== target) refuse('link_conflict', e.id);
  }
  for (const ids of byTarget.values()) if (ids.length > 1) ids.forEach((id) => refuse('link_shared_target', id));
  for (const s of input.sessions) {
    if (s.exercises.some((x) => known.has(x.exerciseId) && links[x.exerciseId] === undefined && !existing.links.some((l) => l.catalogue_id === x.exerciseId))) refuse('session_exercise_unlinked', s.id);
  }

  // 4. What is already there: identical is a no-op, an unpublished row is updated, a different published version is refused.
  const ops: Op[] = [];
  let unchanged = 0;
  const consider = (table: 'exercise_versions' | 'session_templates', rows: Row[], stored: Row[]) => {
    for (const row of [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))) {
      const key = `${row.id}@${row.version}`;
      const found = stored.find((s) => s.id === row.id && s.version === row.version);
      if (!found) ops.push({ kind: 'insert', table, key, row });
      else if (sameContent(row, found)) unchanged += 1;
      else if (found.status === 'published') refuse('version_conflict', String(row.id));
      else ops.push({ kind: 'update', table, key, row, previous: Object.fromEntries(Object.keys(row).map((k) => [k, found[k]])) });
    }
  };
  consider('exercise_versions', input.exercises.map(exerciseRow), existing.exerciseVersions);
  consider('session_templates', input.sessions.map(sessionRow), existing.sessionTemplates);
  for (const e of [...input.exercises].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const target = links[e.id];
    if (typeof target !== 'string') continue;
    const stored = existing.links.find((l) => l.catalogue_id === e.id);
    if (!stored) ops.push({ kind: 'insert', table: 'exercise_links', key: e.id, row: { catalogue_id: e.id, exercise_id: target } });
    else if (stored.exercise_id === target) unchanged += 1;
  }

  if (refusals.length > 0) return { refusals, plan: null };
  const hash = createHash('sha256').update(canonical(ops.map((o) => ({ kind: o.kind, table: o.table, key: o.key, row: o.row })))).digest('hex');
  return { refusals, plan: { ops, unchanged, hash } };
}

export function renderPlan(plan: Plan): string[] {
  const lines = ['DRY RUN: nothing has been written.'];
  if (plan.ops.length === 0) {
    lines.push(`Nothing to import: everything is already in the database (${plan.unchanged} item(s) unchanged).`);
    return lines;
  }
  for (const op of plan.ops) {
    if (op.table === 'exercise_links') lines.push(`LINK ${op.key} -> ${op.row.exercise_id}`);
    else lines.push(`${op.kind.toUpperCase()} ${op.table} ${op.key}`);
    lines.push(JSON.stringify(op.row, null, 2));
  }
  lines.push(`${plan.ops.length} write(s), ${plan.unchanged} unchanged.`, `Plan hash: ${plan.hash}`, 'To apply exactly this, pass the hash above with --apply.');
  return lines;
}

export interface ApplyGuard {
  projectRef: string;
  linkedProjectRef: string;
  supabaseUrl: string;
  confirmProject?: string;
  planHash?: string;
}

function assertDevelopmentProject(guard: ApplyGuard): void {
  let host = '';
  try {
    host = new URL(guard.supabaseUrl).hostname;
  } catch {
    host = '';
  }
  const ok = guard.projectRef === DEV_PROJECT_REF && guard.linkedProjectRef === DEV_PROJECT_REF && host === `${DEV_PROJECT_REF}.supabase.co` && guard.confirmProject === DEV_PROJECT_REF;
  if (!ok) throw new Error(`Refusing to write: this is not the confirmed Rise120 development project (${DEV_PROJECT_REF}).`);
}

export async function applyImport(input: ImportInput, db: ImportDb, guard: ApplyGuard): Promise<{ applied: number; hash: string }> {
  assertDevelopmentProject(guard);
  const { refusals, plan } = buildImportPlan(input, await db.read());
  if (!plan) throw new Error(`Refusing to import: ${refusals.map((r) => `${r.code}:${r.id}`).join(', ')}`);
  if (plan.ops.length === 0) return { applied: 0, hash: plan.hash };
  if (!guard.planHash || guard.planHash !== plan.hash) throw new Error('The plan hash does not match what is in the database now. Run the dry run again and approve that plan.');

  try {
    const result = await db.applyPlan(plan);
    return { applied: result.inserted + result.updated, hash: plan.hash };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('PLAN_STALE')) throw new Error(`The database changed after the dry run (${message}). Nothing was written. Run the dry run again.`);
    throw error;
  }
}
