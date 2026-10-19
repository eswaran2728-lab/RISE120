import { supabase } from '../../lib/supabase';
import { loadGuidedState } from '../guidedSession';
import { loadExercises, loadSessionTemplates } from '../catalogueData';
import { loadExerciseLinks } from '../availability';
import type { ExerciseVersion, SessionTemplate } from '../catalogue';

jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../catalogueData', () => ({ loadExercises: jest.fn(), loadSessionTemplates: jest.fn() }));
jest.mock('../availability', () => ({ loadExerciseLinks: jest.fn() }));

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

const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'A. Coach', role: 'Certified strength coach', reviewedOn: '2026-10-10' };
const exercise = (id: string): ExerciseVersion => ({ id, version: 1, pattern: 'squat', equipment: 'none', name: L(id), cues: [L('one'), L('two')], regressions: [], alternatives: [], media: { kind: 'video', source: 'Rise120 Studio', licence: 'Owned by Rise120' }, reviewer, status: 'published' });
const template = (id: string, ids: string[]): SessionTemplate => ({ id, version: 1, goal: 'recomp', level: 'beginner', minutes: 10, location: 'home', dayType: 'training', exercises: ids.map((exerciseId) => ({ exerciseId, sets: 2, reps: 10 })), reviewer, status: 'published' });
const profile = { data: { equipment: 'home', goal: 'recomp', training_level: 'beginner' } };
const input = { userId: 'A', planId: 'plan-1', dayNumber: 5 };

beforeEach(() => {
  jest.resetAllMocks();
  (loadExercises as jest.Mock).mockResolvedValue([exercise('squat'), exercise('lunge')]);
  (loadSessionTemplates as jest.Mock).mockResolvedValue([template('basic', ['squat', 'lunge'])]);
  (loadExerciseLinks as jest.Mock).mockResolvedValue(new Map([['squat', 'u1'], ['lunge', 'u2']]));
  table({ workout_sessions: { data: [] }, profiles: profile });
});

describe('loadGuidedState', () => {
  it('offers a choice when reviewed, linked sessions exist and nothing was started today', async () => {
    const state = await loadGuidedState(input);

    expect(state).toMatchObject({ kind: 'choose', profile: { equipment: 'home', location: 'home', goal: 'recomp', level: 'beginner' } });
    expect(state.kind === 'choose' && state.catalogue.sessions.map((s) => s.id)).toEqual(['basic']);
  });

  it('resumes the session already started for that plan and day, without needing the catalogue', async () => {
    table({ workout_sessions: { data: [{ id: 's-done', status: 'completed' }, { id: 's-live', status: 'active' }] }, profiles: profile });
    (loadExercises as jest.Mock).mockResolvedValue([]);
    (loadSessionTemplates as jest.Mock).mockResolvedValue([]);

    expect(await loadGuidedState(input)).toEqual({ kind: 'active', sessionId: 's-live' });
  });

  it('reports a finished session as done', async () => {
    table({ workout_sessions: { data: [{ id: 's-done', status: 'completed' }] }, profiles: profile });

    expect(await loadGuidedState(input)).toEqual({ kind: 'done', sessionId: 's-done' });
  });

  it('asks the database about this plan and day only', async () => {
    await loadGuidedState(input);

    const query = (supabase.from as jest.Mock).mock.results[0].value;
    expect(query.eq).toHaveBeenCalledWith('plan_id', 'plan-1');
    expect(query.eq).toHaveBeenCalledWith('day_number', 5);
  });

  it('is unavailable, with no invented content, when nothing is published', async () => {
    (loadExercises as jest.Mock).mockResolvedValue([]);
    (loadSessionTemplates as jest.Mock).mockResolvedValue([]);

    expect(await loadGuidedState(input)).toEqual({ kind: 'unavailable', reason: 'no_catalogue' });
  });

  it('is unavailable when sessions are published but no exercise is linked to a loggable exercise', async () => {
    (loadExerciseLinks as jest.Mock).mockResolvedValue(new Map());

    expect(await loadGuidedState(input)).toEqual({ kind: 'unavailable', reason: 'no_links' });
  });

  it('offers only sessions whose every exercise is linked', async () => {
    (loadExercises as jest.Mock).mockResolvedValue([exercise('squat'), exercise('lunge'), exercise('press')]);
    (loadSessionTemplates as jest.Mock).mockResolvedValue([template('basic', ['squat', 'lunge']), template('partial', ['squat', 'press'])]);

    const state = await loadGuidedState(input);

    expect(state.kind === 'choose' && state.catalogue.sessions.map((s) => s.id)).toEqual(['basic']);
  });

  it('is unreadable, so the card can offer a retry, when the links or the profile cannot be read', async () => {
    (loadExerciseLinks as jest.Mock).mockResolvedValue(null);
    expect(await loadGuidedState(input)).toEqual({ kind: 'unavailable', reason: 'unreadable' });

    (loadExerciseLinks as jest.Mock).mockResolvedValue(new Map([['squat', 'u1'], ['lunge', 'u2']]));
    table({ workout_sessions: { data: [] }, profiles: { data: null, error: { message: 'offline' } } });
    expect(await loadGuidedState(input)).toEqual({ kind: 'unavailable', reason: 'unreadable' });

    table({ workout_sessions: { data: null, error: { message: 'offline' } }, profiles: profile });
    expect(await loadGuidedState(input)).toEqual({ kind: 'unavailable', reason: 'unreadable' });
  });

  it('treats an unknown profile value as unreadable instead of guessing', async () => {
    table({ workout_sessions: { data: [] }, profiles: { data: { equipment: 'home', goal: 'fly', training_level: 'beginner' } } });

    expect(await loadGuidedState(input)).toEqual({ kind: 'unavailable', reason: 'unreadable' });
  });

  it('uses the gym as the place for a member with gym equipment', async () => {
    table({ workout_sessions: { data: [] }, profiles: { data: { equipment: 'gym', goal: 'recomp', training_level: 'beginner' } } });

    const state = await loadGuidedState(input);

    expect(state.kind === 'choose' && state.profile.location).toBe('gym');
  });
});
