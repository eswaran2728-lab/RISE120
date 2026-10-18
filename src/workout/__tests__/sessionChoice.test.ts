import { ExerciseVersion, SessionTemplate, CatalogueInput } from '../catalogue';
import { SessionChoiceInput, selectSession } from '../sessionChoice';

const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'A. Coach', role: 'Certified strength coach', reviewedOn: '2026-10-10' };
const media = { kind: 'video' as const, source: 'Rise120 Studio', licence: 'Owned' };

const ex = (id: string, equipment: ExerciseVersion['equipment'], pattern: ExerciseVersion['pattern'] = 'squat', alt: string): ExerciseVersion => ({
  id,
  version: 1,
  pattern,
  equipment,
  name: L(id),
  cues: [L('cue one'), L('cue two')],
  regressions: [],
  alternatives: [alt],
  media,
  reviewer,
  status: 'published',
});

// Pairs of exercises that can stand in for each other, per equipment class.
const exercises: ExerciseVersion[] = [
  ex('none-a', 'none', 'squat', 'none-b'),
  ex('none-b', 'none', 'squat', 'none-a'),
  ex('none-c', 'none', 'hinge', 'none-d'),
  ex('none-d', 'none', 'hinge', 'none-c'),
  ex('none-e', 'none', 'core', 'none-f'),
  ex('none-f', 'none', 'core', 'none-e'),
  ex('home-a', 'home', 'push', 'home-b'),
  ex('home-b', 'home', 'push', 'home-a'),
  ex('gym-a', 'gym', 'pull', 'gym-b'),
  ex('gym-b', 'gym', 'pull', 'gym-a'),
];

let counter = 0;
// Sets are chosen so each declared length matches the sets (about 100 seconds a set plus 2 minutes of warm-up).
const SETS_FOR: Record<number, number> = { 10: 5, 20: 11, 30: 17, 45: 26, 60: 35 };
function template(over: Partial<SessionTemplate> & { ids?: string[] }): SessionTemplate {
  const minutes = over.minutes ?? 20;
  const ids = over.ids ?? ['none-a', 'none-b'];
  const perExercise = Math.max(1, Math.min(6, Math.round(SETS_FOR[minutes] / ids.length)));
  return {
    id: over.id ?? `t-${++counter}`,
    version: 1,
    goal: 'recomp',
    level: 'beginner',
    minutes: minutes as SessionTemplate['minutes'],
    location: 'home',
    dayType: 'training',
    exercises: ids.map((exerciseId) => ({ exerciseId, sets: perExercise, reps: 10 })),
    reviewer,
    status: 'published',
    ...over,
  };
}

const input = (over: Partial<SessionChoiceInput> = {}): SessionChoiceInput => ({
  minutes: 20,
  location: 'home',
  equipment: 'home',
  energy: 'normal',
  goal: 'recomp',
  level: 'beginner',
  dayType: 'training',
  ...over,
});

const catalogue = (sessions: SessionTemplate[]): CatalogueInput => ({ exercises, sessions });
const idOf = (result: ReturnType<typeof selectSession>) => (result.available ? result.template.id : null);

describe('selectSession', () => {
  describe('time available', () => {
    const six = ['none-a', 'none-b', 'none-c', 'none-d', 'none-e', 'none-f'];
    const sessions = [10, 20, 30, 45, 60].map((m) => template({ id: `m${m}`, minutes: m as 10, ids: six }));

    it.each([10, 20, 30, 45, 60])('picks the %i-minute session when it exists', (minutes) => {
      const result = selectSession(input({ minutes: minutes as 10 }), catalogue(sessions));

      expect(idOf(result)).toBe(`m${minutes}`);
      expect(result).toMatchObject({ available: true, reason: 'fits_time' });
    });

    it('never picks a session longer than the time the member has: it takes the longest one that fits', () => {
      const result = selectSession(input({ minutes: 45 }), catalogue(sessions.filter((s) => s.id !== 'm45')));

      expect(idOf(result)).toBe('m30');
      expect(result).toMatchObject({ reason: 'shorter_to_fit' });
    });

    it('says nothing fits rather than offering something longer', () => {
      const result = selectSession(input({ minutes: 10 }), catalogue(sessions.filter((s) => s.id !== 'm10')));

      expect(result).toEqual({ available: false, reason: 'no_suitable_template' });
    });
  });

  describe('energy', () => {
    const training = template({ id: 'normal-session', minutes: 20, ids: ['none-a', 'none-b'] });
    const gentle = template({ id: 'gentle', minutes: 20, dayType: 'recovery', ids: ['none-a', 'none-b'] });
    const harder = template({ id: 'harder', minutes: 20, level: 'advanced', ids: ['none-a', 'none-b'] });

    it('offers a gentle recovery session when energy is low', () => {
      const result = selectSession(input({ energy: 'low' }), catalogue([training, gentle]));

      expect(idOf(result)).toBe('gentle');
      expect(result).toMatchObject({ reason: 'gentle_for_low_energy' });
    });

    it('falls back to the normal session when there is no gentle one, and says so', () => {
      const result = selectSession(input({ energy: 'low' }), catalogue([training]));

      expect(idOf(result)).toBe('normal-session');
      expect(result).toMatchObject({ reason: 'fits_time' });
    });

    it('treats high energy exactly like normal: no extra session, no harder level', () => {
      const normal = selectSession(input({ energy: 'normal' }), catalogue([training, harder]));
      const high = selectSession(input({ energy: 'high' }), catalogue([training, harder]));

      expect(idOf(high)).toBe('normal-session');
      expect(high).toEqual(normal);
    });
  });

  describe('rest days', () => {
    it('stays a rest day whatever the energy, time or choice', () => {
      const sessions = [template({ id: 'a', minutes: 20 }), template({ id: 'g', minutes: 20, dayType: 'recovery' })];

      for (const energy of ['low', 'normal', 'high'] as const) {
        expect(selectSession(input({ dayType: 'rest', energy }), catalogue(sessions))).toEqual({ available: false, reason: 'rest_day' });
      }
    });
  });

  describe('equipment and place', () => {
    it('never offers a gym session to someone at home', () => {
      const sessions = [template({ id: 'gym-only', minutes: 20, location: 'gym', ids: ['gym-a', 'gym-b'] })];

      expect(selectSession(input({ location: 'home', equipment: 'gym' }), catalogue(sessions))).toEqual({ available: false, reason: 'no_suitable_template' });
    });

    it('offers a gym session at the gym', () => {
      const sessions = [template({ id: 'gym-only', minutes: 20, location: 'gym', ids: ['gym-a', 'gym-b'] })];

      expect(idOf(selectSession(input({ location: 'gym', equipment: 'gym' }), catalogue(sessions)))).toBe('gym-only');
    });

    it('gives a member with no equipment only sessions made of no-equipment exercises', () => {
      const sessions = [template({ id: 'needs-kit', minutes: 20, ids: ['home-a', 'home-b'] }), template({ id: 'bodyweight', minutes: 20, ids: ['none-a', 'none-b'] })];

      expect(idOf(selectSession(input({ equipment: 'none' }), catalogue(sessions)))).toBe('bodyweight');
      expect(idOf(selectSession(input({ equipment: 'none' }), catalogue([sessions[0]])))).toBeNull();
    });

    it('lets a member with home equipment use both home and no-equipment sessions', () => {
      const sessions = [template({ id: 'needs-kit', minutes: 20, ids: ['home-a', 'home-b'] })];

      expect(idOf(selectSession(input({ equipment: 'home' }), catalogue(sessions)))).toBe('needs-kit');
    });
  });

  describe('level and goal', () => {
    it('never gives a beginner an intermediate or advanced session', () => {
      const sessions = [template({ id: 'adv', minutes: 20, level: 'advanced' }), template({ id: 'int', minutes: 20, level: 'intermediate' })];

      expect(selectSession(input({ level: 'beginner' }), catalogue(sessions))).toEqual({ available: false, reason: 'no_suitable_template' });
    });

    it('prefers the member\'s own level over an easier one', () => {
      const sessions = [template({ id: 'easy', minutes: 20, level: 'beginner' }), template({ id: 'own', minutes: 20, level: 'intermediate' })];

      expect(idOf(selectSession(input({ level: 'intermediate' }), catalogue(sessions)))).toBe('own');
    });

    it('prefers the member\'s goal, then general recomposition, then anything else suitable', () => {
      const own = template({ id: 'own-goal', minutes: 20, goal: 'lose_fat' });
      const general = template({ id: 'general', minutes: 20, goal: 'recomp' });
      const other = template({ id: 'other', minutes: 20, goal: 'build_muscle' });

      expect(idOf(selectSession(input({ goal: 'lose_fat' }), catalogue([other, general, own])))).toBe('own-goal');
      expect(idOf(selectSession(input({ goal: 'lose_fat' }), catalogue([other, general])))).toBe('general');
      expect(idOf(selectSession(input({ goal: 'lose_fat' }), catalogue([other])))).toBe('other');
    });
  });

  describe('what may be offered', () => {
    it('never offers a draft or unreviewed session, even if one is passed in', () => {
      const sessions = [template({ id: 'draft', minutes: 20, status: 'draft', reviewer: null })];

      expect(selectSession(input(), catalogue(sessions))).toEqual({ available: false, reason: 'no_suitable_template' });
    });

    it('answers "unavailable" for an empty catalogue instead of failing', () => {
      expect(selectSession(input(), { exercises: [], sessions: [] })).toEqual({ available: false, reason: 'no_suitable_template' });
    });
  });

  describe('variety and repeatability', () => {
    const sessions = [template({ id: 'b', minutes: 20 }), template({ id: 'a', minutes: 20 }), template({ id: 'c', minutes: 20 })];

    it('gives the same answer for the same inputs', () => {
      const first = selectSession(input({ variant: 4 }), catalogue(sessions));

      expect(selectSession(input({ variant: 4 }), catalogue([...sessions].reverse()))).toEqual(first);
    });

    it('rotates through equally suitable sessions as the variant changes, in a fixed order', () => {
      const picks = [0, 1, 2, 3].map((variant) => idOf(selectSession(input({ variant }), catalogue(sessions))));

      expect(picks).toEqual(['a', 'b', 'c', 'a']);
    });
  });
});
