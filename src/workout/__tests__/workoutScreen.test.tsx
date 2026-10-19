import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import WorkoutScreen from '../../../app/(tabs)/workout';
import { t } from '../../i18n';
import { loadPlanBundle } from '../../plan/planData';
import { loadSessionSets } from '../session';
import { loadLimitsOrCached } from '../../monetization/limits';
import { useUnlock } from '../../monetization/useUnlock';

jest.setTimeout(30000);

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]), // eslint-disable-line @typescript-eslint/no-require-imports
}));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: { user: { id: 'A' } } }) }));
jest.mock('../../lib/useLocalDate', () => ({ useLocalDate: () => '2026-10-18' }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock('../../plan/planData', () => ({ loadPlanBundle: jest.fn() }));
jest.mock('../../profile/cache', () => ({ loadUnits: jest.fn().mockResolvedValue('metric') }));
jest.mock('../session', () => ({ loadSessionSets: jest.fn() }));
jest.mock('../../monetization/limits', () => ({ ...jest.requireActual('../../monetization/limits'), loadLimitsOrCached: jest.fn() }));
jest.mock('../../monetization/useUnlock', () => ({ useUnlock: jest.fn() }));
jest.mock('../../ui/GuidedSessionCard', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  GuidedSessionCard: (props: Record<string, unknown>) => require('react').createElement('GuidedSessionCardStub', { testID: 'guided-card', ...props }),
}));

const mocked = { plan: loadPlanBundle as jest.Mock, sets: loadSessionSets as jest.Mock, limits: loadLimitsOrCached as jest.Mock, unlock: useUnlock as jest.Mock };

const exercises = ['e1', 'e2'].map((id, i) => ({ id, name: `Exercise ${i + 1}`, muscleGroup: 'push', equipment: 'gym', instructions: '' }));
const workoutDay = { dayNumber: 18, workout: { kind: 'workout' as const, exercises: [{ exercise_id: 'e1', sets: 2, reps: 10 }, { exercise_id: 'e2', sets: 2, reps: 10 }] }, calorieTarget: 2650, proteinTargetG: 125 };
const restDay = { dayNumber: 18, workout: { kind: 'rest' as const }, calorieTarget: 2650, proteinTargetG: 125 };
const bundle = (day: typeof workoutDay | typeof restDay) => ({ plan: { id: 'p', startDate: '2026-10-01', status: 'active' }, days: [day], exercises });

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
const cards = (tree: ReactTestRenderer) => tree.root.findAll((n) => (n.type as unknown) === 'GuidedSessionCardStub');
async function show(day: typeof workoutDay | typeof restDay) {
  mocked.plan.mockResolvedValue(bundle(day));
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<WorkoutScreen />);
  });
  return tree;
}

beforeEach(() => {
  mocked.sets.mockResolvedValue([]);
  mocked.limits.mockResolvedValue({ snapshot: null });
  mocked.unlock.mockReturnValue({ run: jest.fn() });
});

describe('the Workout tab', () => {
  it('offers the guided session for this plan and day above the regular workout, which still lists every exercise', async () => {
    const tree = await show(workoutDay);

    expect(cards(tree)[0].props).toMatchObject({ userId: 'A', planId: 'p', dayNumber: 18 });
    expect(shows(tree, 'Exercise 1')).toBe(true);
    expect(shows(tree, 'Exercise 2')).toBe(true);
  });

  it('shows no guided session on a rest day', async () => {
    const tree = await show(restDay);

    expect(cards(tree)).toHaveLength(0);
    expect(shows(tree, t('workout.restDay'))).toBe(true);
  });
});
