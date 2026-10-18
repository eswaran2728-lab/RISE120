import { CatalogueInput, ExerciseVersion, SessionTemplate } from '../../workout/catalogue';
import { RETURN_GAP_DAYS, ReturnInput, buildReturnSuggestion } from '../restart';

const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'A. Coach', role: 'Certified strength coach', reviewedOn: '2026-10-10' };
const media = { kind: 'video' as const, source: 'Rise120 Studio', licence: 'Owned' };
const ex = (id: string, alt: string): ExerciseVersion => ({ id, version: 1, pattern: 'squat', equipment: 'none', name: L(id), cues: [L('one'), L('two')], regressions: [], alternatives: [alt], media, reviewer, status: 'published' });
const template = (id: string, minutes: SessionTemplate['minutes'], sets: number): SessionTemplate => ({
  id,
  version: 1,
  goal: 'recomp',
  level: 'beginner',
  minutes,
  location: 'home',
  dayType: 'training',
  exercises: ['a', 'b', 'c', 'd', 'e', 'f'].map((exerciseId) => ({ exerciseId, sets, reps: 10 })),
  reviewer,
  status: 'published',
});
const catalogue: CatalogueInput = {
  exercises: [ex('a', 'b'), ex('b', 'a'), ex('c', 'd'), ex('d', 'c'), ex('e', 'f'), ex('f', 'e')],
  // Six exercises: 10 minutes at 1 set, 20 at 2 sets, 60 at 6 sets (each matches its length).
  sessions: [template('short', 10, 1), template('twenty', 20, 2), template('long', 60, 6)],
};

const input = (over: Partial<ReturnInput> = {}): ReturnInput => ({
  today: '2026-10-18',
  lastActivityDate: '2026-10-10',
  dismissedOn: null,
  equipment: 'none',
  location: 'home',
  goal: 'recomp',
  level: 'beginner',
  ...over,
});

describe('buildReturnSuggestion', () => {
  it('offers a fresh start after a gap of several days, with a manageable session', () => {
    const suggestion = buildReturnSuggestion(input(), catalogue);

    expect(suggestion).toMatchObject({ kind: 'fresh_start', gapDays: 8 });
    if (suggestion.kind === 'fresh_start') expect(suggestion.template.id).toBe('twenty');
  });

  it('never suggests a long session, however long the member usually trains', () => {
    const suggestion = buildReturnSuggestion(input(), catalogue);

    if (suggestion.kind !== 'fresh_start') throw new Error('expected a suggestion');
    expect(suggestion.template.minutes).toBeLessThanOrEqual(20);
  });

  it('does not stack missed volume: the suggestion is a reviewed template exactly as published, whatever the gap', () => {
    const short = buildReturnSuggestion(input({ lastActivityDate: '2026-10-14' }), catalogue);
    const long = buildReturnSuggestion(input({ lastActivityDate: '2026-08-01' }), catalogue);

    if (short.kind !== 'fresh_start' || long.kind !== 'fresh_start') throw new Error('expected suggestions');
    expect(long.template).toEqual(catalogue.sessions.find((s) => s.id === long.template.id));
    expect(long.template.exercises).toEqual(short.template.exercises);
    expect(Object.keys(long).sort()).toEqual(['gapDays', 'kind', 'template']);
  });

  it(`offers nothing for a gap shorter than ${RETURN_GAP_DAYS} days`, () => {
    expect(buildReturnSuggestion(input({ lastActivityDate: '2026-10-17' }), catalogue)).toEqual({ kind: 'none' });
    expect(buildReturnSuggestion(input({ lastActivityDate: '2026-10-18' }), catalogue)).toEqual({ kind: 'none' });
    expect(buildReturnSuggestion(input({ lastActivityDate: '2026-10-16' }), catalogue)).toEqual({ kind: 'none' });
    expect(buildReturnSuggestion(input({ lastActivityDate: '2026-10-15' }), catalogue)).toMatchObject({ kind: 'fresh_start', gapDays: 3 });
  });

  it('offers nothing to someone who has never been active, or with a date in the future', () => {
    expect(buildReturnSuggestion(input({ lastActivityDate: null }), catalogue)).toEqual({ kind: 'none' });
    expect(buildReturnSuggestion(input({ lastActivityDate: '2026-12-01' }), catalogue)).toEqual({ kind: 'none' });
  });

  it('stays quiet for the rest of the day once the member has dismissed it, and comes back tomorrow', () => {
    expect(buildReturnSuggestion(input({ dismissedOn: '2026-10-18' }), catalogue)).toEqual({ kind: 'none' });
    expect(buildReturnSuggestion(input({ dismissedOn: '2026-10-18', today: '2026-10-19' }), catalogue)).toMatchObject({ kind: 'fresh_start' });
  });

  it('offers nothing when no reviewed session fits, rather than inventing one', () => {
    expect(buildReturnSuggestion(input(), { exercises: [], sessions: [] })).toEqual({ kind: 'none' });
    expect(buildReturnSuggestion(input(), { ...catalogue, sessions: [catalogue.sessions[2]] })).toEqual({ kind: 'none' });
  });
});
