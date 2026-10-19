import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import ExerciseScreen from '../../../app/exercise';
import { t } from '../../i18n';
import * as actions from '../sessionActions';
import * as catalogueData from '../catalogueData';
import * as availability from '../availability';
import * as sessionSets from '../session';
import type { ExerciseVersion } from '../catalogue';
import { notifyWorkoutSetLogged } from '../events';

jest.setTimeout(30000);

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]), // eslint-disable-line @typescript-eslint/no-require-imports
  useLocalSearchParams: () => ({ sessionId: 'session-1', exerciseId: 'goblet' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: { user: { id: 'A' } } }) }));
jest.mock('../../lib/useLocalDate', () => ({ useLocalDate: () => '2026-10-19' }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock('../sessionActions', () => ({ loadSessionExercises: jest.fn(), swapRemainingExercise: jest.fn(), completeSession: jest.fn() }));
jest.mock('../events', () => ({ notifyWorkoutSetLogged: jest.fn() }));
jest.mock('../catalogueData', () => ({ loadExercises: jest.fn() }));
jest.mock('../availability', () => ({ loadAvailability: jest.fn(), loadExerciseLinks: jest.fn() }));
jest.mock('../session', () => ({ loadSessionSets: jest.fn() }));

const mocked = {
  load: actions.loadSessionExercises as jest.Mock,
  swap: actions.swapRemainingExercise as jest.Mock,
  complete: actions.completeSession as jest.Mock,
  exercises: catalogueData.loadExercises as jest.Mock,
  availability: availability.loadAvailability as jest.Mock,
  links: availability.loadExerciseLinks as jest.Mock,
  sets: sessionSets.loadSessionSets as jest.Mock,
};

const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'A. Coach', role: 'Certified strength coach', reviewedOn: '2026-10-10' };
const ex = (id: string, over: Partial<ExerciseVersion> = {}): ExerciseVersion => ({
  id, version: 1, pattern: 'squat', equipment: 'none', name: L(id), cues: [L('Chest up'), L('Knees out')], regressions: [], alternatives: [], media: { kind: 'video', source: 'Rise120 Studio', licence: 'Owned by Rise120' }, reviewer, status: 'published', ...over,
});
const catalogue = [ex('goblet', { equipment: 'home', alternatives: ['chair', 'barbell'] }), ex('chair'), ex('barbell', { equipment: 'gym' }), ex('press', { pattern: 'push' })];
const entry = (exerciseId: string, sets: number, over: Record<string, unknown> = {}) => ({ exerciseId, sets, reps: 10, name: L(exerciseId), pattern: 'squat', equipment: 'home', ...over });
const session = (over: Record<string, unknown> = {}) => ({ revision: 0, status: 'active' as const, exercises: [entry('goblet', 3), entry('press', 2)], ...over });
const summary = { setsCompleted: 2, totalReps: 20, volumeKg: 400, byExercise: [{ exerciseId: 'u', name: 'goblet', sets: 2, reps: 20, volumeKg: 400 }] };

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
const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string' && typeof n.props.onPress === 'function').pop();
const press = (tree: ReactTestRenderer, id: string) =>
  act(async () => {
    await byId(tree, id)!.props.onPress();
  });
async function mount() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<ExerciseScreen />);
  });
  return tree;
}

beforeEach(() => {
  Object.values(mocked).forEach((m) => m.mockReset());
  mocked.load.mockResolvedValue(session());
  mocked.exercises.mockResolvedValue(catalogue);
  mocked.availability.mockResolvedValue({ equipment: 'home', location: 'home' });
  mocked.links.mockResolvedValue(new Map([['goblet', 'u-goblet']]));
  mocked.sets.mockResolvedValue([]);
});

describe('the exercise screen', () => {
  it('restarts for each account', () => {
    expect((ExerciseScreen as unknown as { accountScoped?: boolean }).accountScoped).toBe(true);
  });

  it('shows the written cues and only the swaps this member can do', async () => {
    const tree = await mount();

    expect(shows(tree, 'Chest up')).toBe(true);
    expect(byId(tree, 'swap-option-chair')).toBeDefined();
    expect(byId(tree, 'swap-option-barbell')).toBeUndefined(); // needs a gym; the session is at home
  });

  it('still shows the name and a no-video note when the catalogue cannot be read offline', async () => {
    mocked.exercises.mockResolvedValue([]);
    const tree = await mount();

    expect(shows(tree, 'goblet')).toBe(true);
    expect(shows(tree, t('exercise.noVideo'))).toBe(true);
    expect(shows(tree, t('exercise.noSwap'))).toBe(true);
  });

  it('offers no swap rather than guessing when the equipment is unknown', async () => {
    mocked.availability.mockResolvedValue(null);
    const tree = await mount();

    expect(byId(tree, 'swap-option-chair')).toBeUndefined();
    expect(shows(tree, t('exercise.noSwap'))).toBe(true);
  });

  it('shows a retry when the workout cannot be read', async () => {
    mocked.load.mockResolvedValue(null);
    const tree = await mount();
    expect(shows(tree, t('exercise.loadError'))).toBe(true);

    mocked.load.mockResolvedValue(session());
    const retry = tree.root.findAll((n) => typeof n.props.onPress === 'function' && n.findAll((m) => (m.type as unknown) === 'Text' && m.children.includes(t('errors.retry'))).length > 0).pop()!;
    await act(async () => {
      await retry.props.onPress();
    });
    expect(shows(tree, 'Chest up')).toBe(true);
  });
});

describe('swapping', () => {
  const choose = async (tree: ReactTestRenderer) => {
    await press(tree, 'swap-option-chair');
  };

  it('sends the revision it saw, reviews first, and shows the replacement afterwards', async () => {
    mocked.sets.mockResolvedValue([{ exerciseId: 'u-goblet' }, { exerciseId: 'u-goblet' }]); // 2 of 3 done
    mocked.swap.mockResolvedValue({ kind: 'swapped', revision: 1, repeated: false, exercises: [entry('goblet', 2, { kept: true }), entry('chair', 1), entry('press', 2)] });
    const tree = await mount();

    await choose(tree);
    expect(shows(tree, t('exercise.swapReview', { done: 2, remaining: 1, name: 'chair' }))).toBe(true);
    expect(mocked.swap).not.toHaveBeenCalled();
    await press(tree, 'swap-confirm');

    expect(mocked.swap).toHaveBeenCalledTimes(1);
    expect(mocked.swap).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1', expectedRevision: 0, fromExerciseId: 'goblet', replacementId: 'chair', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) }));
    expect(shows(tree, t('exercise.swapDone'))).toBe(true);
    expect(shows(tree, 'chair')).toBe(true);
  });

  it('retries a swap whose answer was lost with the same request id, so it cannot swap twice', async () => {
    mocked.swap.mockResolvedValueOnce({ kind: 'offline' });
    mocked.swap.mockResolvedValueOnce({ kind: 'swapped', revision: 1, repeated: true, exercises: [entry('chair', 3), entry('press', 2)] });
    const tree = await mount();

    await choose(tree);
    await press(tree, 'swap-confirm');
    expect(shows(tree, t('exercise.swapOffline'))).toBe(true);
    await press(tree, 'swap-confirm');

    const [first, second] = mocked.swap.mock.calls.map((c) => c[0]);
    expect(second.requestId).toBe(first.requestId);
    expect(second.expectedRevision).toBe(first.expectedRevision);
  });

  it('reloads the workout and asks the member to check it when the revision is stale', async () => {
    mocked.swap.mockResolvedValue({ kind: 'stale', revision: 2 });
    const tree = await mount();
    mocked.load.mockClear();

    await choose(tree);
    await press(tree, 'swap-confirm');

    expect(shows(tree, t('exercise.stale'))).toBe(true);
    expect(mocked.load).toHaveBeenCalledTimes(1);
  });

  it('says so when the swap is refused, for example for equipment, and changes nothing on screen', async () => {
    mocked.swap.mockResolvedValue({ kind: 'equipment_unsuitable' });
    const tree = await mount();

    await choose(tree);
    await press(tree, 'swap-confirm');

    expect(shows(tree, t('exercise.swapRefused'))).toBe(true);
    expect(shows(tree, 'Chest up')).toBe(true);
  });

  it('does not offer swapping or finishing once the workout is finished', async () => {
    mocked.load.mockResolvedValue(session({ status: 'completed' }));
    const tree = await mount();

    expect(shows(tree, t('exercise.finished'))).toBe(true);
    expect(byId(tree, 'swap-option-chair')).toBeUndefined();
    expect(byId(tree, 'exercise-finish')).toBeUndefined();
    expect(shows(tree, 'Chest up')).toBe(true);
  });
});

describe('finishing the workout', () => {
  it('finishes once however many times the button is tapped, and shows what was actually done', async () => {
    let release!: (value: unknown) => void;
    mocked.complete.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const tree = await mount();

    await act(async () => {
      void byId(tree, 'exercise-finish')!.props.onPress();
      void byId(tree, 'exercise-finish')!.props.onPress();
    });
    await act(async () => release({ kind: 'completed', summary, completedAt: '2026-10-19T01:00:00Z', repeated: false }));

    expect(mocked.complete).toHaveBeenCalledTimes(1);
    expect(shows(tree, t('exercise.summaryTitle'))).toBe(true);
    expect(shows(tree, t('exercise.summarySets', { count: 2 }))).toBe(true);
    expect(shows(tree, t('exercise.summaryVolume', { count: 400 }))).toBe(true);
    expect(byId(tree, 'exercise-finish')).toBeUndefined();
    expect(byId(tree, 'swap-option-chair')).toBeUndefined();
  });

  it('tells the reminders the workout changed once it is finished', async () => {
    mocked.complete.mockResolvedValue({ kind: 'completed', summary, completedAt: '2026-10-19T01:00:00Z', repeated: false });
    const tree = await mount();

    await press(tree, 'exercise-finish');

    expect(notifyWorkoutSetLogged).toHaveBeenCalledWith('A');
  });

  it('shows the same summary when the workout turns out to be finished already', async () => {
    mocked.complete.mockResolvedValue({ kind: 'completed', summary, completedAt: '2026-10-19T01:00:00Z', repeated: true });
    const tree = await mount();

    await press(tree, 'exercise-finish');

    expect(shows(tree, t('exercise.summarySets', { count: 2 }))).toBe(true);
  });

  it('asks for a set to be logged first when nothing was done', async () => {
    mocked.complete.mockResolvedValue({ kind: 'nothing_logged' });
    const tree = await mount();

    await press(tree, 'exercise-finish');

    expect(shows(tree, t('exercise.nothingLogged'))).toBe(true);
    expect(byId(tree, 'exercise-finish')).toBeDefined();
  });

  it('can be tried again after the server could not be reached', async () => {
    mocked.complete.mockResolvedValueOnce({ kind: 'offline' });
    mocked.complete.mockResolvedValueOnce({ kind: 'completed', summary, completedAt: '2026-10-19T01:00:00Z', repeated: false });
    const tree = await mount();

    await press(tree, 'exercise-finish');
    expect(shows(tree, t('exercise.finishOffline'))).toBe(true);
    await press(tree, 'exercise-finish');

    expect(shows(tree, t('exercise.summaryTitle'))).toBe(true);
  });
});
