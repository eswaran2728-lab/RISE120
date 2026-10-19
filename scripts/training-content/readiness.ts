// What stands between a set of draft training content and publication, and which session the app would offer for each
// equipment and time choice once everything is approved. A planning aid only: it never changes content, never writes
// anything, and the "once approved" preview is an in-memory what-if that is not part of any output.
import { CatalogueInput, Equipment, ExerciseVersion, Minutes, SESSION_MINUTES, SessionTemplate, validateCatalogue } from '../../src/workout/catalogue.ts';
import { selectSession } from '../../src/workout/sessionChoice.ts';

export type Blocker = 'no_reviewer' | 'no_media' | 'no_licence' | 'no_home_alternative' | 'duration_mismatch' | 'session_has_unready_exercise';

export interface ItemReadiness {
  kind: 'exercise' | 'session';
  id: string;
  blockers: Blocker[];
}

export interface CoverageRow {
  equipment: Equipment;
  minutes: Minutes;
  session: string | null;
}

const filled = (text: unknown) => typeof text === 'string' && text.trim().length > 0;
const reviewerComplete = (r: { name?: string; role?: string; reviewedOn?: string } | null) => !!r && filled(r.name) && filled(r.role) && filled(r.reviewedOn);

// Everything marked published, with placeholders only where a draft has no reviewer or media yet. Used to ask
// "would this be offered, and how, if it were approved?". Never written out or shown.
export function asIfPublished(input: CatalogueInput): CatalogueInput {
  const reviewer = { name: 'what-if', role: 'what-if', reviewedOn: '2000-01-01' };
  const media = { kind: 'video' as const, source: 'what-if', licence: 'what-if' };
  return {
    exercises: input.exercises.map((e) => ({ ...e, status: 'published' as const, reviewer: e.reviewer ?? reviewer, media: e.media ?? media })),
    sessions: input.sessions.map((s) => ({ ...s, status: 'published' as const, reviewer: s.reviewer ?? reviewer })),
  };
}

function exerciseBlockers(e: ExerciseVersion, all: ExerciseVersion[]): Blocker[] {
  const blockers: Blocker[] = [];
  if (!reviewerComplete(e.reviewer)) blockers.push('no_reviewer');
  if (!e.media) blockers.push('no_media');
  else if (!filled(e.media.source) || !filled(e.media.licence)) blockers.push('no_licence');
  if (e.equipment === 'home' || e.equipment === 'none') {
    const byId = new Map(all.map((x) => [x.id, x]));
    const substitute = e.alternatives.some((id) => {
      const alt = byId.get(id);
      return !!alt && id !== e.id && alt.pattern === e.pattern && (alt.equipment === 'home' || alt.equipment === 'none');
    });
    if (!substitute) blockers.push('no_home_alternative');
  }
  return blockers;
}

export function assessReadiness(input: CatalogueInput): { items: ItemReadiness[]; coverage: CoverageRow[] } {
  const exerciseItems: ItemReadiness[] = input.exercises.map((e) => ({ kind: 'exercise', id: e.id, blockers: exerciseBlockers(e, input.exercises) }));
  const unready = new Set(exerciseItems.filter((i) => i.blockers.length > 0).map((i) => i.id));

  const durationProblems = new Set(validateCatalogue(asIfPublished(input)).errors.filter((e) => e.code === 'duration_mismatch').map((e) => e.id));
  const sessionItems: ItemReadiness[] = input.sessions.map((s: SessionTemplate) => {
    const blockers: Blocker[] = [];
    if (!reviewerComplete(s.reviewer)) blockers.push('no_reviewer');
    if (durationProblems.has(s.id)) blockers.push('duration_mismatch');
    if (s.exercises.some((x) => unready.has(x.exerciseId))) blockers.push('session_has_unready_exercise');
    return { kind: 'session', id: s.id, blockers };
  });

  const preview = asIfPublished(input);
  const coverage: CoverageRow[] = [];
  for (const equipment of ['none', 'home', 'gym'] as Equipment[]) {
    for (const minutes of SESSION_MINUTES) {
      const choice = selectSession({ minutes, location: equipment === 'gym' ? 'gym' : 'home', equipment, energy: 'normal', goal: 'recomp', level: 'beginner', dayType: 'training' }, preview);
      coverage.push({ equipment, minutes, session: choice.available ? choice.template.id : null });
    }
  }
  return { items: [...exerciseItems, ...sessionItems], coverage };
}
