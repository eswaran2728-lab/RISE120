import { CatalogueInput, ExerciseVersion, SessionTemplate, publishedCatalogue, validateCatalogue } from '../catalogue';

const L = (text: string) => ({ en: text, ms: `${text} (ms)`, ta: `${text} (ta)` });
const reviewer = { name: 'A. Coach', role: 'Certified strength coach', reviewedOn: '2026-10-10' };
const media = { kind: 'video' as const, source: 'Rise120 Studio', licence: 'Owned by Rise120', url: 'https://media.example.test/squat.mp4' };

const exercise = (id: string, over: Partial<ExerciseVersion> = {}): ExerciseVersion => ({
  id,
  version: 1,
  pattern: 'squat',
  equipment: 'home',
  name: L(id),
  cues: [L('Keep your chest up'), L('Push through your heels')],
  regressions: [],
  alternatives: [],
  media,
  reviewer,
  status: 'published',
  ...over,
});

const session = (id: string, exercises: string[], over: Partial<SessionTemplate> = {}): SessionTemplate => ({
  id,
  version: 1,
  goal: 'recomp',
  level: 'beginner',
  minutes: 20,
  location: 'home',
  dayType: 'training',
  exercises: exercises.map((exerciseId) => ({ exerciseId, sets: 2, reps: 10 })),
  reviewer,
  status: 'published',
  ...over,
});

// Two home squats that can stand in for each other, a push pair, and a 20-minute session over them.
const good = (): CatalogueInput => ({
  exercises: [
    exercise('squat-a', { alternatives: ['squat-b'] }),
    exercise('squat-b', { alternatives: ['squat-a'] }),
    exercise('push-a', { pattern: 'push', alternatives: ['push-b'] }),
    exercise('push-b', { pattern: 'push', alternatives: ['push-a'] }),
  ],
  sessions: [session('home-basics', ['squat-a', 'push-a', 'squat-b', 'push-b'], { minutes: 20 })],
});

const codes = (input: CatalogueInput) => validateCatalogue(input).errors.map((e) => e.code);
const withExercise = (id: string, change: Partial<ExerciseVersion>): CatalogueInput => {
  const input = good();
  input.exercises = input.exercises.map((e) => (e.id === id ? { ...e, ...change } : e));
  return input;
};

describe('validateCatalogue', () => {
  it('accepts a complete, reviewed catalogue', () => {
    expect(validateCatalogue(good())).toEqual({ ok: true, errors: [] });
  });

  describe('published exercises need a reviewer, cues and a licensed demonstration', () => {
    it('rejects a missing reviewer', () => {
      expect(codes(withExercise('squat-a', { reviewer: null }))).toContain('missing_reviewer');
    });

    it('rejects a reviewer with no review date or role', () => {
      expect(codes(withExercise('squat-a', { reviewer: { name: 'A. Coach', role: '', reviewedOn: '' } }))).toContain('missing_reviewer');
    });

    it('rejects media with no licence or no source', () => {
      expect(codes(withExercise('squat-a', { media: { ...media, licence: '' } }))).toContain('missing_licence');
      expect(codes(withExercise('squat-a', { media: { ...media, source: '' } }))).toContain('missing_licence');
    });

    it('rejects a published exercise with no demonstration at all', () => {
      expect(codes(withExercise('squat-a', { media: null }))).toContain('missing_media');
    });

    it('rejects cues missing in any of English, Malay and Tamil, or fewer than two cues', () => {
      expect(codes(withExercise('squat-a', { cues: [L('one cue')] }))).toContain('missing_cues');
      expect(codes(withExercise('squat-a', { cues: [{ en: 'a', ms: 'b', ta: '' }, L('b')] }))).toContain('missing_cues');
    });

    it('rejects a name missing in a language', () => {
      expect(codes(withExercise('squat-a', { name: { en: 'Squat', ms: '', ta: 'x' } }))).toContain('missing_name');
    });
  });

  describe('drafts and exercises in review may be incomplete, but are never selectable', () => {
    it.each(['draft', 'in_review'] as const)('allows an incomplete %s exercise', (status) => {
      const input = good();
      input.exercises.push(exercise('not-ready', { status, reviewer: null, media: null, cues: [], name: { en: '', ms: '', ta: '' } }));

      expect(validateCatalogue(input).ok).toBe(true);
    });

    it('does not let a published session rely on an exercise that is not published', () => {
      const input = withExercise('push-b', { status: 'draft', reviewer: null });

      expect(codes(input)).toContain('unpublished_exercise');
    });
  });

  describe('references and alternatives', () => {
    it('rejects an alternative or regression that does not exist', () => {
      expect(codes(withExercise('squat-a', { alternatives: ['ghost'] }))).toContain('unknown_reference');
      expect(codes(withExercise('squat-a', { regressions: ['ghost'] }))).toContain('unknown_reference');
    });

    it('rejects an exercise listed as its own alternative', () => {
      expect(codes(withExercise('squat-a', { alternatives: ['squat-a'] }))).toContain('self_reference');
    });

    it('rejects an alternative that trains a different movement pattern', () => {
      expect(codes(withExercise('squat-a', { alternatives: ['push-a'] }))).toContain('alternative_pattern_mismatch');
    });

    it('rejects a published home exercise with no home alternative, so a swap is never promised and then missing', () => {
      const input = good();
      input.exercises = input.exercises.map((e) => (e.id === 'squat-a' ? { ...e, alternatives: [] } : e));

      expect(codes(input)).toContain('no_home_alternative');
    });

    it('does not accept a gym-only alternative as a home alternative', () => {
      const input = good();
      input.exercises = [...input.exercises.map((e) => (e.id === 'squat-a' ? { ...e, alternatives: ['squat-gym'] } : e)), exercise('squat-gym', { equipment: 'gym', alternatives: ['squat-a'] })];

      expect(codes(input)).toContain('no_home_alternative');
    });
  });

  describe('identifiers', () => {
    it('rejects duplicate exercise ids and duplicate session ids', () => {
      const input = good();
      input.exercises.push(exercise('squat-a', { version: 2, alternatives: ['squat-b'] }));
      input.sessions.push(session('home-basics', ['squat-a', 'squat-b', 'push-a', 'push-b']));

      expect(codes(input)).toEqual(expect.arrayContaining(['duplicate_id']));
      expect(codes(input).filter((c) => c === 'duplicate_id')).toHaveLength(2);
    });
  });

  describe('session templates', () => {
    it('rejects a session that names an exercise that does not exist', () => {
      const input = good();
      input.sessions = [session('home-basics', ['squat-a', 'ghost'])];

      expect(codes(input)).toContain('unknown_reference');
    });

    it('rejects a duration that is not one of 10, 20, 30, 45 or 60 minutes', () => {
      const input = good();
      input.sessions = [session('home-basics', ['squat-a', 'push-a', 'squat-b', 'push-b'], { minutes: 25 as never })];

      expect(codes(input)).toContain('bad_minutes');
    });

    it('rejects a declared duration far from what the sets and reps add up to', () => {
      const input = good();
      input.sessions = [session('home-basics', ['squat-a', 'push-a'], { minutes: 60 })];

      expect(codes(input)).toContain('duration_mismatch');
    });

    it('rejects sets or reps outside a sane range', () => {
      const input = good();
      input.sessions = [{ ...session('home-basics', ['squat-a']), exercises: [{ exerciseId: 'squat-a', sets: 0, reps: 10 }] }];

      expect(codes(input)).toContain('bad_prescription');
    });

    it('a recovery session may be short and light but still needs a reviewer when published', () => {
      const input = good();
      input.sessions = [session('recover', ['squat-a'], { dayType: 'recovery', minutes: 10, reviewer: null })];

      expect(codes(input)).toContain('missing_reviewer');
    });
  });
});

describe('publishedCatalogue', () => {
  it('returns only what is published and fully reviewed', () => {
    const input = good();
    input.exercises.push(exercise('draft-one', { status: 'draft', reviewer: null }));
    input.sessions.push(session('draft-session', ['squat-a', 'push-a'], { status: 'draft', reviewer: null }));

    const published = publishedCatalogue(input);

    expect(published.exercises.map((e) => e.id).sort()).toEqual(['push-a', 'push-b', 'squat-a', 'squat-b']);
    expect(published.sessions.map((s) => s.id)).toEqual(['home-basics']);
  });

  it('leaves out a published session whose exercises are not all published, instead of offering half a session', () => {
    const input = withExercise('push-b', { status: 'in_review' });

    expect(publishedCatalogue(input).sessions).toEqual([]);
  });

  it('never returns a published item that failed validation (missing reviewer or licence)', () => {
    const input = withExercise('squat-a', { reviewer: null });

    const published = publishedCatalogue(input);

    expect(published.exercises.map((e) => e.id)).not.toContain('squat-a');
    expect(published.sessions).toEqual([]); // the session needed squat-a
  });

  it('removes a reference to a withdrawn alternative so nobody is offered a swap that is not there', () => {
    const input = withExercise('squat-b', { status: 'draft', reviewer: null });

    const published = publishedCatalogue(input);

    expect(published.exercises.find((e) => e.id === 'squat-a')?.alternatives).toEqual([]);
  });

  it('is empty, not an error, when nothing is published yet', () => {
    expect(publishedCatalogue({ exercises: [], sessions: [] })).toEqual({ exercises: [], sessions: [] });
  });
});
