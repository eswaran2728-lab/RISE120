import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { GuidedSessionCard } from '../../ui/GuidedSessionCard';
import SessionScreen from '../../../app/session';
import ExerciseScreen from '../../../app/exercise';
import { t } from '../../i18n';
import type { CatalogueInput, ExerciseVersion, SessionTemplate } from '../catalogue';
import type { SessionExercise } from '../sessionActions';
import * as guided from '../guidedSession';
import * as sessions from '../sessions';
import * as actions from '../sessionActions';
import * as catalogueData from '../catalogueData';
import * as availability from '../availability';
import * as sessionSets from '../session';
import * as log from '../log';

jest.setTimeout(60000);

// The whole path a member takes, across the three screens, against a small in-memory stand-in for the server that
// enforces the same rules (one session per day, revisions, finishing once). Only the network edge is replaced.
let mockParams: Record<string, string> = {};
const mockPush = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]), // eslint-disable-line @typescript-eslint/no-require-imports
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
}));
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: { user: { id: 'A' } } }) }));
jest.mock('../../lib/useLocalDate', () => ({ useLocalDate: () => '2026-10-19' }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock('../../profile/cache', () => ({ loadUnits: jest.fn().mockResolvedValue('metric') }));
jest.mock('../../sync/flush', () => ({ flushPending: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../sync/supabaseTransport', () => ({ supabaseTransport: {} }));
jest.mock('../guidedSession', () => ({ loadGuidedState: jest.fn() }));
jest.mock('../sessions', () => ({ startSession: jest.fn() }));
jest.mock('../sessionActions', () => ({ loadSessionExercises: jest.fn(), swapRemainingExercise: jest.fn(), completeSession: jest.fn() }));
jest.mock('../catalogueData', () => ({ loadExercises: jest.fn() }));
jest.mock('../availability', () => ({ loadAvailability: jest.fn(), loadExerciseLinks: jest.fn() }));
jest.mock('../session', () => ({ loadSessionSets: jest.fn() }));
jest.mock('../log', () => ({ ...jest.requireActual('../log'), queueWorkoutSet: jest.fn() }));

const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'A. Coach', role: 'Certified strength coach', reviewedOn: '2026-10-10' };
const media = { kind: 'video' as const, source: 'Rise120 Studio', licence: 'Owned by Rise120' };
const ex = (id: string, over: Partial<ExerciseVersion> = {}): ExerciseVersion => ({ id, version: 1, pattern: 'squat', equipment: 'none', name: L(id), cues: [L('Chest up'), L('Knees out')], regressions: [], alternatives: [], media, reviewer, status: 'published', ...over });
const exercises = [ex('squat'), ex('lunge', { alternatives: ['stepup'] }), ex('stepup')];
const template: SessionTemplate = { id: 'basic', version: 1, goal: 'recomp', level: 'beginner', minutes: 10, location: 'home', dayType: 'training', exercises: [{ exerciseId: 'squat', sets: 2, reps: 10 }, { exerciseId: 'lunge', sets: 2, reps: 10 }], reviewer, status: 'published' };
const catalogue: CatalogueInput = { exercises, sessions: [template] };
const uuids = new Map([['squat', 'u-squat'], ['lunge', 'u-lunge'], ['stepup', 'u-stepup']]);

type Server = { started: number; completions: number; status: 'none' | 'active' | 'completed'; revision: number; list: SessionExercise[]; sets: { exerciseId: string; setNumber: number; reps: number; weightKg: number; id: string; pending: boolean }[]; swapRequests: Set<string> };
let server: Server;
const entry = (exerciseId: string, sets: number, over: Partial<SessionExercise> = {}): SessionExercise => ({ exerciseId, sets, reps: 10, name: L(exerciseId), pattern: 'squat', equipment: 'none', ...over });

const textsOf = (tree: ReactTestRenderer): string[] => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') out.push(node);
    else if (node && typeof node === 'object') ((node as { children?: unknown[] | null }).children ?? []).forEach(walk);
  };
  walk(tree.toJSON());
  return out;
};
const shows = (tree: ReactTestRenderer, text: string) => textsOf(tree).some((s) => s.includes(text));
const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string' && (typeof n.props.onPress === 'function' || typeof n.props.onChangeText === 'function')).pop();
const press = (tree: ReactTestRenderer, id: string) =>
  act(async () => {
    await byId(tree, id)!.props.onPress();
  });
const type = (tree: ReactTestRenderer, id: string, text: string) =>
  act(async () => {
    byId(tree, id)!.props.onChangeText(text);
  });
const mount = async (element: React.ReactElement) => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
};
const lastPush = () => mockPush.mock.calls[mockPush.mock.calls.length - 1][0] as { pathname: string; params: Record<string, string> };

beforeEach(() => {
  mockPush.mockReset();
  mockParams = {};
  server = { started: 0, completions: 0, status: 'none', revision: 0, list: [], sets: [], swapRequests: new Set() };

  (guided.loadGuidedState as jest.Mock).mockImplementation(async () =>
    server.status === 'active' ? { kind: 'active', sessionId: 'session-1' } : server.status === 'completed' ? { kind: 'done', sessionId: 'session-1' } : { kind: 'choose', catalogue, profile: { equipment: 'none', location: 'home', goal: 'recomp', level: 'beginner' } }
  );
  (sessions.startSession as jest.Mock).mockImplementation(async () => {
    const resumed = server.status !== 'none';
    if (!resumed) {
      server.started += 1;
      server.status = 'active';
      server.list = template.exercises.map((x) => entry(x.exerciseId, x.sets));
    }
    return { kind: 'started', sessionId: 'session-1', resumed, snapshot: {} };
  });
  (actions.loadSessionExercises as jest.Mock).mockImplementation(async () => (server.status === 'none' ? null : { revision: server.revision, status: server.status, exercises: server.list.map((e) => ({ ...e })) }));
  (actions.swapRemainingExercise as jest.Mock).mockImplementation(async (input: { requestId: string; expectedRevision: number; fromExerciseId: string; replacementId: string }) => {
    if (server.swapRequests.has(input.requestId)) return { kind: 'swapped', revision: server.revision, exercises: server.list, repeated: true };
    if (server.status !== 'active') return { kind: 'session_completed' };
    if (input.expectedRevision !== server.revision) return { kind: 'stale', revision: server.revision };
    const at = server.list.findIndex((e) => e.exerciseId === input.fromExerciseId && !e.kept);
    if (at < 0) return { kind: 'nothing_to_swap' };
    const done = server.sets.filter((s) => s.exerciseId === uuids.get(input.fromExerciseId)).length;
    const original = server.list[at];
    const replacement = entry(input.replacementId, original.sets - done);
    server.list.splice(at, 1, ...(done > 0 ? [{ ...original, sets: done, kept: true }] : []), replacement);
    server.revision += 1;
    server.swapRequests.add(input.requestId);
    return { kind: 'swapped', revision: server.revision, exercises: server.list, repeated: false };
  });
  (actions.completeSession as jest.Mock).mockImplementation(async () => {
    if (server.sets.length === 0) return { kind: 'nothing_logged' };
    const repeated = server.status === 'completed';
    if (!repeated) {
      server.completions += 1;
      server.status = 'completed';
    }
    const summary = { setsCompleted: server.sets.length, totalReps: server.sets.reduce((n, s) => n + s.reps, 0), volumeKg: 0, byExercise: [] };
    return { kind: 'completed', summary, completedAt: '2026-10-19T01:00:00Z', repeated };
  });
  (catalogueData.loadExercises as jest.Mock).mockResolvedValue(exercises);
  (availability.loadAvailability as jest.Mock).mockResolvedValue({ equipment: 'none', location: 'home' });
  (availability.loadExerciseLinks as jest.Mock).mockImplementation(async () => uuids);
  (sessionSets.loadSessionSets as jest.Mock).mockImplementation(async () => server.sets.map((s) => ({ ...s })));
  (log.queueWorkoutSet as jest.Mock).mockImplementation(async (_user: string, _day: string, input: { exerciseId: string; setNumber: number; reps: string; weight: string }) => {
    server.sets.push({ id: `${input.exerciseId}-${input.setNumber}`, exerciseId: input.exerciseId, setNumber: input.setNumber, reps: Number(input.reps), weightKg: Number(input.weight), pending: false });
    return 'id';
  });
});

describe('choose, start, swap, log, finish', () => {
  it('lets a member go all the way through a guided session, finishing exactly once', async () => {
    // 1. Today / Workout: choose a reviewed session and start it.
    const card = await mount(<GuidedSessionCard userId="A" planId="plan-1" dayNumber={5} />);
    await press(card, 'guided-minutes-10');
    await press(card, 'guided-find');
    expect(shows(card, t('guided.proposal', { minutes: 10, count: 2 }))).toBe(true);
    await press(card, 'guided-start');
    expect(server.started).toBe(1);
    expect(lastPush()).toEqual({ pathname: '/session', params: { sessionId: 'session-1' } });

    // 2. The session screen: log a set of the first exercise.
    mockParams = { sessionId: 'session-1' };
    let session = await mount(<SessionScreen />);
    expect(shows(session, t('guided.setsProgress', { done: 0, total: 2 }))).toBe(true);
    await press(session, 'session-log-squat');
    await type(session, 'session-reps', '10');
    await type(session, 'session-weight', '20');
    await press(session, 'session-save');
    expect(shows(session, t('guided.setsProgress', { done: 1, total: 2 }))).toBe(true);

    // 3. Open the second exercise and swap its remaining sets.
    await press(session, 'session-open-lunge');
    expect(lastPush()).toEqual({ pathname: '/exercise', params: { sessionId: 'session-1', exerciseId: 'lunge' } });
    mockParams = { sessionId: 'session-1', exerciseId: 'lunge' };
    const exercise = await mount(<ExerciseScreen />);
    expect(shows(exercise, 'Chest up')).toBe(true);
    await press(exercise, 'swap-option-stepup');
    await press(exercise, 'swap-confirm');
    expect(shows(exercise, t('exercise.swapDone'))).toBe(true);
    expect(server.list.map((e) => e.exerciseId)).toEqual(['squat', 'stepup']);
    expect(server.sets.map((s) => s.exerciseId)).toEqual(['u-squat']); // the set already logged is untouched

    // 4. Back on the session screen: the replacement is there; log a set of it.
    mockParams = { sessionId: 'session-1' };
    session = await mount(<SessionScreen />);
    expect(shows(session, t('guided.setsProgress', { done: 0, total: 2 }))).toBe(true);
    await press(session, 'session-log-stepup');
    await type(session, 'session-reps', '12');
    await type(session, 'session-weight', '0');
    await press(session, 'session-save');
    expect(server.sets.map((s) => s.exerciseId)).toEqual(['u-squat', 'u-stepup']);

    // 5. Finish, with a double tap: one completion, the summary shows what was done.
    await act(async () => {
      void byId(session, 'session-finish')!.props.onPress();
      void byId(session, 'session-finish')!.props.onPress();
    });
    expect(server.completions).toBe(1);
    expect(shows(session, t('exercise.summarySets', { count: 2 }))).toBe(true);

    // 6. The entry card now shows it as done and offers no second start.
    const again = await mount(<GuidedSessionCard userId="A" planId="plan-1" dayNumber={5} />);
    expect(shows(again, t('guided.done'))).toBe(true);
    expect(byId(again, 'guided-start')).toBeUndefined();
    expect(server.started).toBe(1);
  });

  it('resumes the session already under way instead of starting another', async () => {
    const first = await mount(<GuidedSessionCard userId="A" planId="plan-1" dayNumber={5} />);
    await press(first, 'guided-find');
    await press(first, 'guided-start');

    const second = await mount(<GuidedSessionCard userId="A" planId="plan-1" dayNumber={5} />);
    expect(byId(second, 'guided-find')).toBeUndefined();
    await press(second, 'guided-resume');

    expect(server.started).toBe(1);
    expect(lastPush()).toEqual({ pathname: '/session', params: { sessionId: 'session-1' } });
  });

  it('keeps the manual workout path when the catalogue is empty: the card says so and starts nothing', async () => {
    (guided.loadGuidedState as jest.Mock).mockResolvedValue({ kind: 'unavailable', reason: 'no_catalogue' });
    const card = await mount(<GuidedSessionCard userId="A" planId="plan-1" dayNumber={5} />);

    expect(shows(card, t('guided.unavailable'))).toBe(true);
    expect(byId(card, 'guided-start')).toBeUndefined();
    expect(server.started).toBe(0);
  });
});
