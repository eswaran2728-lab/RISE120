// Checks the training content under content/exercises and content/sessions with the same rules the app uses to
// decide what it may offer. Exit code 1 means a real problem; having nothing published yet is reported as an
// unfinished launch gate, not a failure. A file that cannot be read is named but its text is never printed.
import { CatalogueInput, ExerciseVersion, SessionTemplate, publishedCatalogue, validateCatalogue } from '../../src/workout/catalogue.ts';

export interface ContentFile {
  path: string;
  text: string;
}
export interface ContentFiles {
  exercises: ContentFile[];
  sessions: ContentFile[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const STATUSES = ['published', 'in_review', 'draft'];

function looksLikeExercise(value: unknown): value is ExerciseVersion {
  return isRecord(value) && typeof value.id === 'string' && typeof value.version === 'number' && typeof value.pattern === 'string' && typeof value.equipment === 'string' && isRecord(value.name) && Array.isArray(value.cues) && Array.isArray(value.alternatives) && Array.isArray(value.regressions) && STATUSES.includes(value.status as string);
}
function looksLikeSession(value: unknown): value is SessionTemplate {
  return isRecord(value) && typeof value.id === 'string' && typeof value.version === 'number' && typeof value.minutes === 'number' && Array.isArray(value.exercises) && STATUSES.includes(value.status as string);
}

function parseAll<T>(files: ContentFile[], accept: (value: unknown) => value is T, problems: string[]): T[] {
  const out: T[] = [];
  for (const file of files) {
    let value: unknown;
    try {
      value = JSON.parse(file.text);
    } catch {
      problems.push(`${file.path}: not valid JSON`);
      continue;
    }
    if (!accept(value)) {
      problems.push(`${file.path}: not the expected shape`);
      continue;
    }
    out.push(value);
  }
  return out;
}

const count = (items: { status: string }[]) => ({
  published: items.filter((i) => i.status === 'published').length,
  inReview: items.filter((i) => i.status === 'in_review').length,
  draft: items.filter((i) => i.status === 'draft').length,
});

export function runValidation(files: ContentFiles): { exitCode: number; lines: string[] } {
  const problems: string[] = [];
  const input: CatalogueInput = {
    exercises: parseAll(files.exercises, looksLikeExercise, problems),
    sessions: parseAll(files.sessions, looksLikeSession, problems),
  };

  const result = validateCatalogue(input);
  for (const error of result.errors) problems.push(`${error.id}: ${error.code}`);

  const e = count(input.exercises);
  const s = count(input.sessions);
  const offered = publishedCatalogue(input);
  const lines = [
    `exercises: ${input.exercises.length} (published ${e.published}, in review ${e.inReview}, draft ${e.draft})`,
    `sessions: ${input.sessions.length} (published ${s.published}, in review ${s.inReview}, draft ${s.draft})`,
    `offered to members: ${offered.exercises.length} exercises, ${offered.sessions.length} sessions`,
  ];
  if (offered.exercises.length === 0 && offered.sessions.length === 0) {
    lines.push('Nothing is published yet. Reviewed, licensed content is a launch gate: until it exists the app has no session templates to offer.');
  }
  if (problems.length > 0) {
    lines.push(`${problems.length} problem(s):`, ...problems.map((p) => `  ${p}`));
    return { exitCode: 1, lines };
  }
  lines.push('Content is valid.');
  return { exitCode: 0, lines };
}
