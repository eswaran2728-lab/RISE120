// The reviewed exercise and session catalogue. Content is written by people (and reviewed by a qualified person);
// this module only checks it and decides what the app may offer. Only a published item that passes every check is
// ever selectable. Drafts and items in review may be incomplete, but they are never offered. Nothing in this file
// invents content: with nothing published the catalogue is simply empty.
export type Pattern = 'squat' | 'hinge' | 'push' | 'pull' | 'core';
export type Equipment = 'gym' | 'home' | 'none';
export type Status = 'draft' | 'in_review' | 'published';
export type Goal = 'lose_fat' | 'build_muscle' | 'recomp';
export type Level = 'beginner' | 'intermediate' | 'advanced';
export type Minutes = 10 | 20 | 30 | 45 | 60;
export type Localised = { en: string; ms: string; ta: string };

export const SESSION_MINUTES: readonly Minutes[] = [10, 20, 30, 45, 60];

export interface Reviewer {
  name: string;
  role: string;
  reviewedOn: string; // YYYY-MM-DD
}

export interface Media {
  kind: 'video' | 'image';
  source: string; // who made it
  licence: string; // under what terms Rise120 may show it
  url?: string;
}

export interface ExerciseVersion {
  id: string;
  version: number;
  pattern: Pattern;
  equipment: Equipment;
  name: Localised;
  cues: Localised[]; // short text cues, each in all three languages
  regressions: string[]; // easier versions (exercise ids)
  alternatives: string[]; // reviewed substitutes for the same movement (exercise ids)
  media: Media | null;
  reviewer: Reviewer | null;
  status: Status;
}

export interface SessionExercise {
  exerciseId: string;
  sets: number;
  reps: number;
}

export interface SessionTemplate {
  id: string;
  version: number;
  goal: Goal;
  level: Level;
  minutes: Minutes;
  location: 'home' | 'gym';
  dayType: 'training' | 'recovery';
  exercises: SessionExercise[];
  reviewer: Reviewer | null;
  status: Status;
}

export interface CatalogueInput {
  exercises: ExerciseVersion[];
  sessions: SessionTemplate[];
}

export type ErrorCode =
  | 'duplicate_id'
  | 'missing_reviewer'
  | 'missing_name'
  | 'missing_cues'
  | 'missing_media'
  | 'missing_licence'
  | 'unknown_reference'
  | 'self_reference'
  | 'alternative_pattern_mismatch'
  | 'no_home_alternative'
  | 'unpublished_exercise'
  | 'bad_minutes'
  | 'duration_mismatch'
  | 'bad_prescription';

export interface ValidationError {
  code: ErrorCode;
  id: string; // the exercise or session the problem is in
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

const LANGUAGES: (keyof Localised)[] = ['en', 'ms', 'ta'];
const filled = (text: unknown) => typeof text === 'string' && text.trim().length > 0;
const completeText = (text: Localised | undefined) => !!text && LANGUAGES.every((language) => filled(text[language]));
const completeReviewer = (r: Reviewer | null) => !!r && filled(r.name) && filled(r.role) && filled(r.reviewedOn);

// One set is about 40 seconds of work and 60 of rest; a session adds two minutes of warm-up. The declared length
// must be near this, so a "20 minute" session cannot be four sets of nothing.
const SECONDS_PER_SET = 100;
const WARM_UP_SECONDS = 120;
const DURATION_TOLERANCE = 0.35;
const estimatedMinutes = (session: SessionTemplate) => (session.exercises.reduce((total, e) => total + e.sets * SECONDS_PER_SET, 0) + WARM_UP_SECONDS) / 60;

// What a published exercise needs on its own (not about other items).
function exerciseErrors(e: ExerciseVersion): ErrorCode[] {
  if (e.status !== 'published') return [];
  const errors: ErrorCode[] = [];
  if (!completeReviewer(e.reviewer)) errors.push('missing_reviewer');
  if (!completeText(e.name)) errors.push('missing_name');
  if (!Array.isArray(e.cues) || e.cues.length < 2 || !e.cues.every(completeText)) errors.push('missing_cues');
  if (!e.media) errors.push('missing_media');
  else if (!filled(e.media.licence) || !filled(e.media.source)) errors.push('missing_licence');
  return errors;
}

function prescriptionOk(session: SessionTemplate): boolean {
  return (
    session.exercises.length > 0 &&
    session.exercises.every((x) => Number.isInteger(x.sets) && x.sets >= 1 && x.sets <= 6 && Number.isInteger(x.reps) && x.reps >= 1 && x.reps <= 50)
  );
}

export function validateCatalogue(input: CatalogueInput): ValidationResult {
  const errors: ValidationError[] = [];
  const add = (code: ErrorCode, id: string) => errors.push({ code, id });
  const byId = new Map(input.exercises.map((e) => [e.id, e]));

  const seenExercises = new Set<string>();
  for (const e of input.exercises) {
    if (seenExercises.has(e.id)) add('duplicate_id', e.id);
    seenExercises.add(e.id);
    for (const code of exerciseErrors(e)) add(code, e.id);

    for (const ref of e.regressions) {
      if (ref === e.id) add('self_reference', e.id);
      else if (!byId.has(ref)) add('unknown_reference', e.id);
    }
    for (const ref of e.alternatives) {
      if (ref === e.id) add('self_reference', e.id);
      else if (!byId.has(ref)) add('unknown_reference', e.id);
      else if (byId.get(ref)!.pattern !== e.pattern) add('alternative_pattern_mismatch', e.id);
    }
    // A home exercise promises home members a swap: there must be a published substitute they can do at home.
    if (e.status === 'published' && (e.equipment === 'home' || e.equipment === 'none')) {
      const hasHomeSubstitute = e.alternatives.some((ref) => {
        const alt = byId.get(ref);
        return !!alt && ref !== e.id && alt.status === 'published' && alt.pattern === e.pattern && (alt.equipment === 'home' || alt.equipment === 'none');
      });
      if (!hasHomeSubstitute) add('no_home_alternative', e.id);
    }
  }

  const seenSessions = new Set<string>();
  for (const s of input.sessions) {
    if (seenSessions.has(s.id)) add('duplicate_id', s.id);
    seenSessions.add(s.id);
    if (!SESSION_MINUTES.includes(s.minutes)) add('bad_minutes', s.id);
    if (!prescriptionOk(s)) add('bad_prescription', s.id);
    for (const x of s.exercises) {
      const ex = byId.get(x.exerciseId);
      if (!ex) add('unknown_reference', s.id);
      else if (s.status === 'published' && ex.status !== 'published') add('unpublished_exercise', s.id);
    }
    if (s.status === 'published') {
      if (!completeReviewer(s.reviewer)) add('missing_reviewer', s.id);
      if (SESSION_MINUTES.includes(s.minutes) && prescriptionOk(s) && Math.abs(estimatedMinutes(s) - s.minutes) / s.minutes > DURATION_TOLERANCE) add('duration_mismatch', s.id);
    }
  }

  return { ok: errors.length === 0, errors };
}

// Everything the app may offer: published, reviewed, complete, and whole (a session only if every one of its
// exercises is offered too). An alternative or regression that is not offered is dropped from the list, so nobody
// is shown a swap that is not there. Nothing published gives an empty catalogue, not an error.
export function publishedCatalogue(input: CatalogueInput): CatalogueInput {
  const offered = input.exercises.filter((e) => e.status === 'published' && exerciseErrors(e).length === 0);
  const ids = new Set(offered.map((e) => e.id));
  const byId = new Map(offered.map((e) => [e.id, e]));

  const exercises = offered.map((e) => ({
    ...e,
    regressions: e.regressions.filter((ref) => ref !== e.id && ids.has(ref)),
    alternatives: e.alternatives.filter((ref) => ref !== e.id && ids.has(ref) && byId.get(ref)!.pattern === e.pattern),
  }));

  const sessions = input.sessions.filter(
    (s) =>
      s.status === 'published' &&
      completeReviewer(s.reviewer) &&
      SESSION_MINUTES.includes(s.minutes) &&
      prescriptionOk(s) &&
      s.exercises.every((x) => ids.has(x.exerciseId)) &&
      Math.abs(estimatedMinutes(s) - s.minutes) / s.minutes <= DURATION_TOLERANCE
  );

  return { exercises, sessions };
}
