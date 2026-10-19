import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import SessionScreen from '../../../app/session';
import { t } from '../../i18n';
import * as actions from '../sessionActions';
import * as availability from '../availability';
import * as sessionSets from '../session';
import * as log from '../log';

jest.setTimeout(30000);

const mockPush = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]), // eslint-disable-line @typescript-eslint/no-require-imports
  useLocalSearchParams: () => ({ sessionId: 'session-1' }),
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
}));
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: { user: { id: 'A' } } }) }));
jest.mock('../../lib/useLocalDate', () => ({ useLocalDate: () => '2026-10-19' }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock('../../profile/cache', () => ({ loadUnits: jest.fn().mockResolvedValue('metric') }));
jest.mock('../../sync/flush', () => ({ flushPending: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../sync/supabaseTransport', () => ({ supabaseTransport: {} }));
jest.mock('../sessionActions', () => ({ loadSessionExercises: jest.fn(), completeSession: jest.fn() }));
jest.mock('../availability', () => ({ loadExerciseLinks: jest.fn() }));
jest.mock('../session', () => ({ loadSessionSets: jest.fn() }));
jest.mock('../log', () => ({ ...jest.requireActual('../log'), queueWorkoutSet: jest.fn() }));

const mocked = {
  load: actions.loadSessionExercises as jest.Mock,
  complete: actions.completeSession as jest.Mock,
  links: availability.loadExerciseLinks as jest.Mock,
  sets: sessionSets.loadSessionSets as jest.Mock,
  queue: log.queueWorkoutSet as jest.Mock,
};

const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const entry = (exerciseId: string, sets: number, over: Record<string, unknown> = {}) => ({ exerciseId, sets, reps: 10, name: L(exerciseId), pattern: 'squat', equipment: 'none', ...over });
const session = (over: Record<string, unknown> = {}) => ({ revision: 0, status: 'active' as const, exercises: [entry('squat', 3), entry('lunge', 2)], ...over });
const set = (exerciseId: string, setNumber: number) => ({ id: `${exerciseId}-${setNumber}`, exerciseId, setNumber, reps: 10, weightKg: 20, pending: false });
const summary = { setsCompleted: 2, totalReps: 20, volumeKg: 400, byExercise: [] };

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
async function mount() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<SessionScreen />);
  });
  return tree;
}

beforeEach(() => {
  mockPush.mockReset();
  Object.values(mocked).forEach((m) => m.mockReset());
  mocked.load.mockResolvedValue(session());
  mocked.links.mockResolvedValue(new Map([['squat', 'u-squat'], ['lunge', 'u-lunge']]));
  mocked.sets.mockResolvedValue([]);
  mocked.queue.mockResolvedValue('set-id');
});

describe('the session screen', () => {
  it('restarts for each account', () => {
    expect((SessionScreen as unknown as { accountScoped?: boolean }).accountScoped).toBe(true);
  });

  it('lists the exercises with the sets done out of the sets planned', async () => {
    mocked.sets.mockResolvedValue([set('u-squat', 1), set('u-squat', 2)]);
    const tree = await mount();

    expect(shows(tree, 'squat')).toBe(true);
    expect(shows(tree, t('guided.setsProgress', { done: 2, total: 3 }))).toBe(true);
    expect(shows(tree, t('guided.setsProgress', { done: 0, total: 2 }))).toBe(true);
  });

  it('shows the sets done before a swap as done, and gives them no log button', async () => {
    mocked.load.mockResolvedValue(session({ exercises: [entry('squat', 2, { kept: true }), entry('chair', 1), entry('lunge', 2)] }));
    mocked.links.mockResolvedValue(new Map([['squat', 'u-squat'], ['chair', 'u-chair'], ['lunge', 'u-lunge']]));
    const tree = await mount();

    expect(shows(tree, t('guided.kept'))).toBe(true);
    expect(byId(tree, 'session-log-squat')).toBeUndefined();
    expect(byId(tree, 'session-log-chair')).toBeDefined();
  });

  it('shows a retry when the session cannot be read', async () => {
    mocked.load.mockResolvedValueOnce(null);
    const tree = await mount();
    expect(shows(tree, t('guided.loadError'))).toBe(true);

    const retry = tree.root.findAll((n) => typeof n.props.onPress === 'function' && n.findAll((m) => (m.type as unknown) === 'Text' && m.children.includes(t('errors.retry'))).length > 0).pop()!;
    await act(async () => {
      await retry.props.onPress();
    });

    expect(shows(tree, 'squat')).toBe(true);
  });
});

describe('logging sets', () => {
  it('queues the set against the linked exercise and this session, then shows the new count', async () => {
    const tree = await mount();
    await press(tree, 'session-log-squat');
    await type(tree, 'session-reps', '10');
    await type(tree, 'session-weight', '20');
    mocked.sets.mockResolvedValue([set('u-squat', 1)]);

    await press(tree, 'session-save');

    expect(mocked.queue).toHaveBeenCalledWith('A', '2026-10-19', { exerciseId: 'u-squat', setNumber: 1, reps: '10', weight: '20', units: 'metric', sessionId: 'session-1' });
    expect(shows(tree, t('guided.setsProgress', { done: 1, total: 3 }))).toBe(true);
  });

  it('numbers the next set after the ones already logged', async () => {
    mocked.sets.mockResolvedValue([set('u-squat', 1), set('u-squat', 2)]);
    const tree = await mount();
    await press(tree, 'session-log-squat');
    await type(tree, 'session-reps', '8');
    await type(tree, 'session-weight', '0');

    await press(tree, 'session-save');

    expect(mocked.queue).toHaveBeenCalledWith('A', '2026-10-19', expect.objectContaining({ setNumber: 3 }));
  });

  it('refuses reps that are not a number and queues nothing', async () => {
    const tree = await mount();
    await press(tree, 'session-log-squat');
    await type(tree, 'session-reps', 'abc');
    await type(tree, 'session-weight', '20');

    await press(tree, 'session-save');

    expect(mocked.queue).not.toHaveBeenCalled();
    expect(shows(tree, t('onboarding.errors.number'))).toBe(true);
  });

  it('says an exercise without a link cannot be logged yet, instead of logging it to the wrong place', async () => {
    mocked.links.mockResolvedValue(new Map([['lunge', 'u-lunge']]));
    const tree = await mount();

    expect(byId(tree, 'session-log-squat')).toBeUndefined();
    expect(shows(tree, t('guided.cannotLog'))).toBe(true);
    expect(byId(tree, 'session-log-lunge')).toBeDefined();
  });
});

describe('opening an exercise and finishing', () => {
  it('opens the exercise screen for the chosen exercise of this session', async () => {
    const tree = await mount();

    await press(tree, 'session-open-lunge');

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/exercise', params: { sessionId: 'session-1', exerciseId: 'lunge' } });
  });

  it('finishes once however many times it is tapped, and shows what was actually done', async () => {
    let release!: (value: unknown) => void;
    mocked.complete.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const tree = await mount();

    await act(async () => {
      void byId(tree, 'session-finish')!.props.onPress();
      void byId(tree, 'session-finish')!.props.onPress();
    });
    await act(async () => release({ kind: 'completed', summary, completedAt: '2026-10-19T01:00:00Z', repeated: false }));

    expect(mocked.complete).toHaveBeenCalledTimes(1);
    expect(shows(tree, t('exercise.summarySets', { count: 2 }))).toBe(true);
    expect(byId(tree, 'session-finish')).toBeUndefined();
    expect(byId(tree, 'session-log-squat')).toBeUndefined();
  });

  it('explains nothing-logged and offline, and can be tried again', async () => {
    mocked.complete.mockResolvedValueOnce({ kind: 'nothing_logged' });
    mocked.complete.mockResolvedValueOnce({ kind: 'offline' });
    mocked.complete.mockResolvedValueOnce({ kind: 'completed', summary, completedAt: 'x', repeated: false });
    const tree = await mount();

    await press(tree, 'session-finish');
    expect(shows(tree, t('exercise.nothingLogged'))).toBe(true);
    await press(tree, 'session-finish');
    expect(shows(tree, t('exercise.finishOffline'))).toBe(true);
    await press(tree, 'session-finish');

    expect(shows(tree, t('exercise.summaryTitle'))).toBe(true);
  });

  it('shows a finished session read-only', async () => {
    mocked.load.mockResolvedValue(session({ status: 'completed' }));
    const tree = await mount();

    expect(shows(tree, t('guided.finishedNote'))).toBe(true);
    expect(byId(tree, 'session-finish')).toBeUndefined();
    expect(byId(tree, 'session-log-squat')).toBeUndefined();
    expect(byId(tree, 'session-open-squat')).toBeDefined();
  });
});
