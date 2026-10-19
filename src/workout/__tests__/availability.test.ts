import { supabase } from '../../lib/supabase';
import { loadAvailability, loadExerciseLinks } from '../availability';

jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const table = (answers: Record<string, { data: unknown; error?: unknown }>) =>
  (supabase.from as jest.Mock).mockImplementation((name: string) => {
    const answer = { data: answers[name]?.data ?? null, error: answers[name]?.error ?? null };
    const query: Record<string, jest.Mock> = {};
    query.select = jest.fn(() => query);
    query.eq = jest.fn(() => query);
    query.single = jest.fn().mockResolvedValue(answer);
    (query as unknown as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(answer);
    return query;
  });

beforeEach(() => jest.resetAllMocks());

describe('loadAvailability', () => {
  it('combines the members equipment with where the session happens', async () => {
    table({ profiles: { data: { equipment: 'home' } }, workout_sessions: { data: { snapshot: { location: 'gym' } } } });

    expect(await loadAvailability('u1', 's1')).toEqual({ equipment: 'home', location: 'gym' });
  });

  it.each([
    ['unknown equipment', { profiles: { data: { equipment: 'jetpack' } }, workout_sessions: { data: { snapshot: { location: 'home' } } } }],
    ['unknown location', { profiles: { data: { equipment: 'home' } }, workout_sessions: { data: { snapshot: { location: 'moon' } } } }],
    ['no session', { profiles: { data: { equipment: 'home' } }, workout_sessions: { data: null } }],
    ['a read error', { profiles: { data: null, error: { message: 'offline' } }, workout_sessions: { data: { snapshot: { location: 'home' } } } }],
  ])('gives null for %s, so the screen never guesses', async (_name, answers) => {
    table(answers);

    expect(await loadAvailability('u1', 's1')).toBeNull();
  });
});

describe('loadExerciseLinks', () => {
  it('maps each catalogue exercise to the exercise that logged sets use', async () => {
    table({ exercise_links: { data: [{ catalogue_id: 'squat', exercise_id: 'uuid-1' }, { catalogue_id: 'press', exercise_id: 'uuid-2' }] } });

    const links = await loadExerciseLinks();

    expect(links?.get('squat')).toBe('uuid-1');
    expect(links?.get('press')).toBe('uuid-2');
  });

  it('gives null when the links cannot be read', async () => {
    table({ exercise_links: { data: null, error: { message: 'offline' } } });

    expect(await loadExerciseLinks()).toBeNull();
  });
});
