import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import CycleReviewScreen from '../../../app/cycle-review';
import TodayScreen from '../../../app/(tabs)/today';
import i18next, { t } from '../../i18n';
import { loadPlanBundle } from '../../plan/planData';
import { loadCheckinDates, loadWorkoutDates } from '../../today/load';
import { startNextCycle } from '../cycles';
import { clearPendingCycle, takePendingCycle } from '../pendingCycle';

jest.setTimeout(30000);

let mockUserId: string | null = 'A';
let mockDate = '2026-09-29'; // day 121 of a cycle that started 2026-06-01
const mockRouter = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return { useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]), useRouter: () => mockRouter };
});
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: mockUserId ? { user: { id: mockUserId } } : null }) }));
jest.mock('../../lib/useLocalDate', () => ({ useLocalDate: () => mockDate }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock('../../plan/planData', () => ({ loadPlanBundle: jest.fn() }));
jest.mock('../../today/load', () => ({ loadCheckinDates: jest.fn(), loadWorkoutDates: jest.fn() }));
jest.mock('../cycles', () => ({ startNextCycle: jest.fn() }));
jest.mock('../pendingCycle', () => ({ takePendingCycle: jest.fn(), clearPendingCycle: jest.fn() }));
jest.mock('../../plan/ensurePlan', () => ({ ensurePlan: jest.fn() }));
jest.mock('../../plan/generatePlan', () => ({ generatePlan: jest.fn() }));
jest.mock('../../plan/previewSeen', () => ({ hasSeenPreview: jest.fn().mockResolvedValue(true) }));
jest.mock('../../checkin/load', () => ({ loadCheckin: jest.fn().mockResolvedValue(null) }));
jest.mock('../../workout/session', () => ({ loadSessionSets: jest.fn().mockResolvedValue([]) }));
jest.mock('../../monetization/limits', () => ({ ...jest.requireActual('../../monetization/limits'), loadLimitsOrCached: jest.fn().mockResolvedValue(null) }));
jest.mock('../../monetization/useUnlock', () => ({ useUnlock: () => ({ run: jest.fn() }) }));

const mocked = {
  plan: loadPlanBundle as jest.Mock,
  checkins: loadCheckinDates as jest.Mock,
  workouts: loadWorkoutDates as jest.Mock,
  start: startNextCycle as jest.Mock,
  take: takePendingCycle as jest.Mock,
  clear: clearPendingCycle as jest.Mock,
};

const bundle = { plan: { id: 'p1', startDate: '2026-06-01', status: 'active', cycleNumber: 1 }, days: [], exercises: [] };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
// The innermost element with this id that can be pressed: for a button that is the touchable itself, so the
// button's own duplicate-tap guard is part of what is tested.
const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string' && typeof n.props.onPress === 'function').pop();
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
const press = async (tree: ReactTestRenderer, id: string) => {
  const node = byId(tree, id);
  await act(async () => {
    await node!.props.onPress();
  });
};
async function mount(element: React.ReactElement = <CycleReviewScreen />) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockUserId = 'A';
  mockDate = '2026-09-29';
  await i18next.changeLanguage('en');
  mocked.plan.mockResolvedValue(bundle);
  mocked.checkins.mockResolvedValue(['2026-06-01', '2026-06-02', '2026-06-02', '2027-01-01']);
  mocked.workouts.mockResolvedValue(['2026-06-03']);
  mocked.take.mockImplementation(async (_user: string, mode: string) => ({ requestId: '3f2b8c1e-1111-4222-8333-444455556666', mode }));
  mocked.clear.mockResolvedValue(undefined);
  mocked.start.mockResolvedValue({ kind: 'started', planId: 'p2', cycleNumber: 2, created: true });
});

describe('the end-of-cycle review', () => {
  it('shows what the member did as plain counts, and the two choices, and starts nothing by itself', async () => {
    const tree = await mount();

    expect(shows(tree, t('cycle.checkinDays', { count: 2 }))).toBe(true);
    expect(shows(tree, t('cycle.workoutDays', { count: 1 }))).toBe(true);
    expect(byId(tree, 'cycle-progression')).toBeDefined();
    expect(byId(tree, 'cycle-maintenance')).toBeDefined();
    expect(mocked.start).not.toHaveBeenCalled();
  });

  it('explains each choice in words, and that earlier logs stay', async () => {
    const tree = await mount();

    expect(shows(tree, t('cycle.progressionBody'))).toBe(true);
    expect(shows(tree, t('cycle.maintenanceBody'))).toBe(true);
    expect(shows(tree, t('cycle.logsStay'))).toBe(true);
  });

  it('starts the chosen cycle with the saved request id, the mode and today\'s date, then goes to Today', async () => {
    const tree = await mount();

    await press(tree, 'cycle-maintenance');

    expect(mocked.start).toHaveBeenCalledWith('A', { requestId: '3f2b8c1e-1111-4222-8333-444455556666', mode: 'maintenance', startDate: '2026-09-29' });
    expect(mocked.clear).toHaveBeenCalledWith('A');
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/today');
  });

  it('ignores a second tap while the first is still running', async () => {
    const answer = deferred<unknown>();
    mocked.start.mockReturnValue(answer.promise);
    const tree = await mount();

    await act(async () => {
      void byId(tree, 'cycle-progression')!.props.onPress();
      void byId(tree, 'cycle-progression')!.props.onPress();
      void byId(tree, 'cycle-maintenance')!.props.onPress();
    });
    await act(async () => answer.resolve({ kind: 'started', planId: 'p2', cycleNumber: 2, created: true }));

    expect(mocked.start).toHaveBeenCalledTimes(1);
  });

  it('keeps the same request for a retry after no answer arrived, and says so', async () => {
    mocked.start.mockResolvedValueOnce({ kind: 'offline' }).mockResolvedValue({ kind: 'started', planId: 'p2', cycleNumber: 2, created: false });
    const tree = await mount();

    await press(tree, 'cycle-progression');
    expect(shows(tree, t('cycle.offline'))).toBe(true);
    expect(mocked.clear).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await press(tree, 'cycle-progression');

    expect(mocked.take).toHaveBeenCalledTimes(2);
    expect(mocked.start.mock.calls[1][1].requestId).toBe(mocked.start.mock.calls[0][1].requestId);
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/today');
  });

  it.each([
    ['not_finished', 'cycle.notFinished'],
    ['no_plan', 'cycle.noPlan'],
    ['profile_incomplete', 'cycle.profileIncomplete'],
    ['invalid', 'cycle.error'],
    ['error', 'cycle.error'],
  ])('shows a message for %s and stays on the review', async (kind, key) => {
    mocked.start.mockResolvedValue({ kind });
    const tree = await mount();

    await press(tree, 'cycle-progression');

    expect(shows(tree, t(key))).toBe(true);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('opens only after day 120: before that it says so and offers no choice', async () => {
    mockDate = '2026-09-28'; // day 120
    const tree = await mount();

    expect(shows(tree, t('cycle.notReady'))).toBe(true);
    expect(byId(tree, 'cycle-progression')).toBeUndefined();
    expect(byId(tree, 'cycle-maintenance')).toBeUndefined();
  });

  it('says there is nothing to review when the account has no plan', async () => {
    mocked.plan.mockResolvedValue(null);
    const tree = await mount();

    expect(shows(tree, t('cycle.noPlan'))).toBe(true);
    expect(byId(tree, 'cycle-progression')).toBeUndefined();
  });

  it('shows a retry when the plan cannot be read, instead of the choices', async () => {
    mocked.plan.mockRejectedValue(new Error('offline'));
    const tree = await mount();

    expect(shows(tree, t('cycle.loadError'))).toBe(true);
    expect(byId(tree, 'cycle-progression')).toBeUndefined();
  });

  it('does not move the screen on when the answer arrives after the account has changed', async () => {
    const answer = deferred<unknown>();
    mocked.start.mockReturnValue(answer.promise);
    const tree = await mount();
    await act(async () => {
      void byId(tree, 'cycle-progression')!.props.onPress();
    });

    mockUserId = 'B';
    await act(async () => tree.unmount());
    await act(async () => answer.resolve({ kind: 'started', planId: 'p2', cycleNumber: 2, created: true }));

    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['ms', 'cycle.progression'],
    ['ta', 'cycle.progression'],
  ])('is translated in %s', async (language, key) => {
    await i18next.changeLanguage(language);
    const tree = await mount();

    expect(shows(tree, t(key))).toBe(true);
    expect(t(key)).not.toBe('Start another 120 days');
  });
});

describe('Today after day 120', () => {
  beforeEach(async () => {
    const { ensurePlan } = jest.requireMock('../../plan/ensurePlan') as { ensurePlan: jest.Mock };
    ensurePlan.mockResolvedValue({ bundle, created: false });
  });

  it('offers the review instead of a dead end', async () => {
    const tree = await mount(<TodayScreen />);

    expect(shows(tree, t('today.planComplete'))).toBe(true);
    await press(tree, 'today-review-cycle');
    expect(mockRouter.push).toHaveBeenCalledWith('/cycle-review');
  });
});
