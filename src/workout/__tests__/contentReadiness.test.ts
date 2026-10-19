import { assessReadiness, asIfPublished } from '../../../scripts/training-content/readiness';
import type { CatalogueInput, ExerciseVersion, SessionTemplate } from '../catalogue';

const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'Someone Qualified', role: 'Certified strength coach', reviewedOn: '2026-10-10' };
const media = { kind: 'video' as const, source: 'Rise120 Studio', licence: 'Owned by Rise120' };
const exercise = (id: string, over: Partial<ExerciseVersion> = {}): ExerciseVersion => ({
  id, version: 1, pattern: 'squat', equipment: 'none', name: L(id), cues: [L('one'), L('two')], regressions: [], alternatives: [], media: null, reviewer: null, status: 'draft', ...over,
});
const session = (id: string, minutes: 10 | 20, exerciseIds: string[], over: Partial<SessionTemplate> = {}): SessionTemplate => ({
  id, version: 1, goal: 'recomp', level: 'beginner', minutes, location: 'home', dayType: 'training', exercises: exerciseIds.map((exerciseId) => ({ exerciseId, sets: minutes === 10 ? 2 : 3, reps: 10 })), reviewer: null, status: 'draft', ...over,
});
const squats = (): ExerciseVersion[] => [exercise('a', { alternatives: ['b'] }), exercise('b', { alternatives: ['a'] })];
const blockersOf = (result: ReturnType<typeof assessReadiness>, id: string) => result.items.find((i) => i.id === id)!.blockers;

describe('assessReadiness', () => {
  it('lists what a draft still needs before it could be published: a reviewer and media', () => {
    const result = assessReadiness({ exercises: squats(), sessions: [session('s10', 10, ['a', 'b'])] });

    expect(blockersOf(result, 'a')).toEqual(['no_reviewer', 'no_media']);
    expect(blockersOf(result, 's10')).toContain('no_reviewer');
  });

  it('asks for the licence when media names a source but not the terms, and for the source when it has only terms', () => {
    const ex = [exercise('a', { alternatives: ['b'], media: { kind: 'video', source: 'Rise120 Studio', licence: ' ' }, reviewer }), exercise('b', { alternatives: ['a'], media: { kind: 'video', source: '', licence: 'Owned' }, reviewer })];

    const result = assessReadiness({ exercises: ex, sessions: [] });

    expect(blockersOf(result, 'a')).toEqual(['no_licence']);
    expect(blockersOf(result, 'b')).toEqual(['no_licence']);
  });

  it('has no blockers for an exercise with a reviewer and media evidence', () => {
    const ex = squats().map((e) => ({ ...e, reviewer, media }));

    expect(assessReadiness({ exercises: ex, sessions: [] }).items.every((i) => i.blockers.length === 0)).toBe(true);
  });

  it('flags a home or bodyweight exercise that has no home substitute', () => {
    const result = assessReadiness({ exercises: [exercise('a'), exercise('b', { alternatives: ['a'] })], sessions: [] });

    expect(blockersOf(result, 'a')).toContain('no_home_alternative');
    expect(blockersOf(result, 'b')).not.toContain('no_home_alternative');
  });

  it('flags a session whose declared length does not fit its sets, even while it is a draft', () => {
    const tooShort = session('tiny', 20, ['a']); // 3 sets is about 7 minutes, not 20

    expect(blockersOf(assessReadiness({ exercises: squats(), sessions: [tooShort] }), 'tiny')).toContain('duration_mismatch');
  });

  it('flags a session that includes an exercise which is itself not ready', () => {
    const ex = [{ ...squats()[0], reviewer, media }, squats()[1]];

    const result = assessReadiness({ exercises: ex, sessions: [session('s10', 10, ['a', 'b'], { reviewer })] });

    expect(blockersOf(result, 's10')).toEqual(['session_has_unready_exercise']);
  });

  it('does not change what it is given, and never reports a reviewer or licence it made up', () => {
    const input: CatalogueInput = { exercises: squats(), sessions: [session('s10', 10, ['a', 'b'])] };
    const before = JSON.stringify(input);

    const result = assessReadiness(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(/simulation/i);
  });
});

describe('coverage of the time choices', () => {
  const cat: CatalogueInput = {
    exercises: [exercise('a', { alternatives: ['b'] }), exercise('b', { alternatives: ['a'] }), exercise('weights', { equipment: 'home', alternatives: ['a'] })],
    sessions: [session('home-10', 10, ['a', 'b']), session('home-20', 20, ['a', 'b', 'a', 'b'], { exercises: [{ exerciseId: 'a', sets: 3, reps: 10 }, { exerciseId: 'b', sets: 3, reps: 10 }, { exerciseId: 'weights', sets: 3, reps: 10 }, { exerciseId: 'a', sets: 3, reps: 10 }] })],
  };

  it('says, for each equipment and time choice, which session the app would offer once the drafts are approved', () => {
    const { coverage } = assessReadiness(cat);
    const pick = (equipment: string, minutes: number) => coverage.find((c) => c.equipment === equipment && c.minutes === minutes)!.session;

    expect(pick('none', 10)).toBe('home-10');
    expect(pick('none', 20)).toBe('home-10'); // the 20-minute session needs weights, so a no-equipment member gets the shorter one
    expect(pick('home', 20)).toBe('home-20');
    expect(pick('home', 60)).toBe('home-20');
  });

  it('reports nothing for a choice that no session can serve', () => {
    const { coverage } = assessReadiness({ exercises: [], sessions: [] });

    expect(coverage.every((c) => c.session === null)).toBe(true);
    expect(coverage).toHaveLength(3 * 5); // none, home, gym times 10, 20, 30, 45, 60
  });
});

describe('asIfPublished', () => {
  it('is only a what-if for checks: it marks everything published without touching the original', () => {
    const original: CatalogueInput = { exercises: squats(), sessions: [] };
    const preview = asIfPublished(original);

    expect(preview.exercises.every((e) => e.status === 'published')).toBe(true);
    expect(original.exercises.every((e) => e.status === 'draft')).toBe(true);
  });
});
