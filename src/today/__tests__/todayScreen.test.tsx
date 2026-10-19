import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import TodayScreen from '../../../app/(tabs)/today';
import i18next, { t } from '../../i18n';
import { tokens } from '../../theme/tokens';
import { loadPlanBundle } from '../../plan/planData';
import { loadCheckin } from '../../checkin/load';
import { loadCheckinDates } from '../load';
import { loadSessionSets } from '../../workout/session';
import { hasSeenPreview } from '../../plan/previewSeen';
import { loadLimitsOrCached } from '../../monetization/limits';
import { useUnlock } from '../../monetization/useUnlock';

jest.setTimeout(30000);

const mockRouter = { push: jest.fn(), navigate: jest.fn() };
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return { useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]), useRouter: () => mockRouter };
});
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: { user: { id: 'A' } } }) }));
jest.mock('../../lib/useLocalDate', () => ({ useLocalDate: () => '2026-10-18' }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock('../../plan/planData', () => ({ loadPlanBundle: jest.fn() }));
jest.mock('../../plan/generatePlan', () => ({ generatePlan: jest.fn() }));
jest.mock('../../plan/previewSeen', () => ({ hasSeenPreview: jest.fn() }));
jest.mock('../../checkin/load', () => ({ loadCheckin: jest.fn() }));
jest.mock('../load', () => ({ loadCheckinDates: jest.fn() }));
jest.mock('../../workout/session', () => ({ loadSessionSets: jest.fn() }));
jest.mock('../../monetization/limits', () => ({ ...jest.requireActual('../../monetization/limits'), loadLimitsOrCached: jest.fn() }));
jest.mock('../../ui/GuidedSessionCard', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  GuidedSessionCard: (props: Record<string, unknown>) => require('react').createElement('GuidedSessionCardStub', { testID: 'guided-card', ...props }),
}));
jest.mock('../../monetization/useUnlock', () => ({ useUnlock: jest.fn() }));

const mocked = {
  plan: loadPlanBundle as jest.Mock,
  checkin: loadCheckin as jest.Mock,
  dates: loadCheckinDates as jest.Mock,
  sets: loadSessionSets as jest.Mock,
  preview: hasSeenPreview as jest.Mock,
  limits: loadLimitsOrCached as jest.Mock,
  unlock: useUnlock as jest.Mock,
};

const EX = ['e1', 'e2', 'e3', 'e4', 'e5'];
const exercises = EX.map((id, i) => ({ id, name: `Exercise ${i + 1}`, muscleGroup: 'push', equipment: 'gym', instructions: '' }));
const workoutDay = (dayNumber = 18) => ({
  dayNumber,
  workout: { kind: 'workout' as const, exercises: EX.map((exercise_id) => ({ exercise_id, sets: 2, reps: 10 })) },
  calorieTarget: 2650,
  proteinTargetG: 125,
});
const restDay = (dayNumber = 18) => ({ dayNumber, workout: { kind: 'rest' as const }, calorieTarget: 2650, proteinTargetG: 125 });
// Start 2026-10-01 makes 2026-10-18 journey day 18.
const bundle = (day: ReturnType<typeof workoutDay> | ReturnType<typeof restDay>, startDate = '2026-10-01') => ({
  plan: { id: 'p', startDate, status: 'active' },
  days: [day],
  exercises,
});
const logged = (n: number) => EX.flatMap((exerciseId) => [{ exerciseId }, { exerciseId }]).slice(0, n);

async function show(options: { day?: ReturnType<typeof workoutDay> | ReturnType<typeof restDay>; sets?: number; checkin?: boolean; startDate?: string } = {}) {
  mocked.plan.mockResolvedValue(bundle(options.day ?? workoutDay(), options.startDate));
  mocked.sets.mockResolvedValue(logged(options.sets ?? 0));
  mocked.checkin.mockResolvedValue(options.checkin ? { id: 'c' } : null);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<TodayScreen />);
  });
  return tree;
}

const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string');
// How many buttons (or views) carry this id on screen, counted once on the host element.
const count = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type === 'string').length;
const textIn = (node: { findAll: ReactTestRenderer['root']['findAll'] }) =>
  node.findAll((x) => (x.type as unknown) === 'Text').flatMap((x) => x.children.map(String)).join('');
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
  const node = byId(tree, id)[0];
  await act(async () => {
    node.props.onPress();
  });
};
const flat = (style: unknown): Record<string, any> => Object.assign({}, ...[style].flat(5).filter(Boolean));

beforeEach(async () => {
  jest.clearAllMocks();
  await i18next.changeLanguage('en');
  mocked.preview.mockResolvedValue(true);
  mocked.dates.mockResolvedValue([]);
  mocked.limits.mockResolvedValue({ snapshot: null, stale: false });
  mocked.unlock.mockReturnValue({ run: jest.fn() });
});

describe('journey arc', () => {
  it('shows the real journey day from the calendar, labelled for screen readers', async () => {
    const tree = await show();

    const arc = tree.root.findAll((n) => n.props.accessibilityRole === 'progressbar' && typeof n.type === 'string')[0];
    expect(arc.props.accessibilityLabel).toBe('Journey day 18 of 120');
    expect(arc.props.accessibilityValue.now).toBe(18);
    expect(shows(tree, 'Day 18 of 120')).toBe(true);
  });

  it('does not move when the workout or check-in is done: completion is shown separately', async () => {
    const idle = await show({ sets: 0, checkin: false });
    const finished = await show({ sets: 10, checkin: true });

    const nowOf = (tree: ReactTestRenderer) => tree.root.findAll((n) => n.props.accessibilityRole === 'progressbar' && typeof n.type === 'string')[0].props.accessibilityValue.now;
    expect(nowOf(idle)).toBe(18);
    expect(nowOf(finished)).toBe(18);
  });

  it('follows the calendar day, not the number of finished days', async () => {
    const tree = await show({ day: workoutDay(40), startDate: '2026-09-09' });

    const arc = tree.root.findAll((n) => n.props.accessibilityRole === 'progressbar' && typeof n.type === 'string')[0];
    expect(arc.props.accessibilityLabel).toBe('Journey day 40 of 120');
  });
});

describe('the gold session card and its one action', () => {
  it('has exactly one primary action on a workout day: Start workout, which opens the Workout tab', async () => {
    const tree = await show();

    const primary = byId(tree, 'today-primary-action');
    expect(count(tree, 'today-primary-action')).toBe(1);
    expect(shows(tree, 'Start workout')).toBe(true);
    expect(flat(primary[0].props.style).backgroundColor).toBe(tokens.color.bg); // dark button on the gold card
    await press(tree, 'today-primary-action');
    expect(mockRouter.navigate).toHaveBeenCalledWith('/(tabs)/workout');
  });

  it('puts the session on the gold surface with dark text', async () => {
    const tree = await show();

    const card = byId(tree, 'today-session-card')[0] ?? tree.root.findAll((n) => n.props.testID === 'today-session-card')[0];
    expect(flat(card.props.style).backgroundColor).toBe(tokens.color.accent);
  });

  it('offers Resume workout with set progress once some planned sets are logged', async () => {
    const tree = await show({ sets: 4 });

    expect(shows(tree, 'Resume workout')).toBe(true);
    expect(shows(tree, '4 of 10 sets')).toBe(true);
    expect(shows(tree, 'Start workout')).toBe(false);
  });

  it('says all planned sets are done and offers View workout when finished', async () => {
    const tree = await show({ sets: 10 });

    expect(shows(tree, 'All planned sets done')).toBe(true);
    expect(shows(tree, 'View workout')).toBe(true);
    await press(tree, 'today-primary-action');
    expect(mockRouter.navigate).toHaveBeenCalledWith('/(tabs)/workout');
  });

  it('on a rest day the card says rest and its one action is the check-in', async () => {
    const tree = await show({ day: restDay() });

    expect(shows(tree, t('today.restDay'))).toBe(true);
    expect(shows(tree, 'Start workout')).toBe(false);
    expect(count(tree, 'today-primary-action')).toBe(1);
    await press(tree, 'today-primary-action');
    expect(mockRouter.push).toHaveBeenCalledWith('/checkin');
    expect(count(tree, 'today-checkin')).toBe(0); // no second check-in button
  });
});

describe('today\'s small steps', () => {
  it('shows workout and check-in progress as separate words, not colour alone', async () => {
    const tree = await show({ sets: 10, checkin: false });

    expect(byId(tree, 'today-step-workout')[0]).toBeDefined();
    expect(shows(tree, 'Done')).toBe(true); // workout
    expect(shows(tree, 'Not done yet')).toBe(true); // check-in
  });

  it('keeps the check-in as a secondary action on a workout day', async () => {
    const tree = await show();

    expect(count(tree, 'today-primary-action')).toBe(1);
    const checkin = byId(tree, 'today-checkin');
    expect(count(tree, 'today-checkin')).toBe(1);
    expect(flat(checkin[0].props.style).backgroundColor).not.toBe(tokens.color.accent);
    await press(tree, 'today-checkin');
    expect(mockRouter.push).toHaveBeenCalledWith('/checkin');
  });

  it('lets a finished check-in be edited, with its own words', async () => {
    const tree = await show({ checkin: true });

    expect(shows(tree, t('today.checkinDone'))).toBe(true);
    await press(tree, 'today-checkin');
    expect(mockRouter.push).toHaveBeenCalledWith('/checkin');
  });
});

describe('other Today behaviour is kept', () => {
  it('still opens Settings and Food', async () => {
    const tree = await show();

    await press(tree, 'today-settings');
    expect(mockRouter.push).toHaveBeenCalledWith('/settings');
    await press(tree, 'today-log-food');
    expect(mockRouter.navigate).toHaveBeenCalledWith('/(tabs)/food');
  });

  it('still shows the daily targets and the health disclaimer', async () => {
    const tree = await show();

    expect(shows(tree, '2650')).toBe(true);
    expect(shows(tree, '125')).toBe(true);
    expect(shows(tree, t('health.disclaimer'))).toBe(true);
  });

  it('still sends a new plan to the preview once', async () => {
    mocked.preview.mockResolvedValue(false);

    await show();

    expect(mockRouter.push).toHaveBeenCalledWith('/plan-preview');
  });

  it('still shows the retry state when the plan cannot load, and retries the load', async () => {
    mocked.plan.mockRejectedValue(new Error('offline'));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<TodayScreen />);
    });

    expect(shows(tree, t('today.planError'))).toBe(true);
    mocked.plan.mockResolvedValue(bundle(workoutDay()));
    mocked.sets.mockResolvedValue([]);
    mocked.checkin.mockResolvedValue(null);
    const retry = tree.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.type !== 'string' && textIn(n).includes(t('errors.retry')))[0];
    await act(async () => {
      retry.props.onPress();
    });
    expect(shows(tree, 'Day 18 of 120')).toBe(true);
  });

  it('still shows the locked-day notice with check-in and food available', async () => {
    mocked.plan.mockResolvedValue({ plan: { id: 'p', startDate: '2026-10-01', status: 'active' }, days: [], exercises });
    mocked.sets.mockResolvedValue([]);
    mocked.checkin.mockResolvedValue(null);
    mocked.limits.mockResolvedValue({
      snapshot: { tier: 'free', quotaDayUtc: '2026-10-18', resetsAt: '2026-10-19T00:00:00.000Z', planDaysAccessible: 14, food: { used: 0, base: 3, bonus: 0, remaining: 3 }, ai: { used: 0, base: 1, bonus: 0, remaining: 1 }, adRewards: { used: 0, max: 3, remaining: 3 } },
      stale: false,
    });
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<TodayScreen />);
    });

    expect(shows(tree, t('limits.planLocked'))).toBe(true);
    expect(shows(tree, t('today.checkin'))).toBe(true);
    expect(shows(tree, t('today.logFood'))).toBe(true);
  });
});

describe('accessibility', () => {
  it('gives every button a touch target of at least 48 points', async () => {
    const tree = await show();

    const buttons = tree.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.type !== 'string');
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const button of buttons) expect(flat(button.props.style).minHeight).toBeGreaterThanOrEqual(tokens.minTap);
  });

  it('never turns off text scaling and sets no fixed height on text', async () => {
    const tree = await show();

    const texts = tree.root.findAll((n) => (n.type as unknown) === 'Text');
    expect(texts.length).toBeGreaterThan(5);
    for (const text of texts) {
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(flat(text.props.style).height).toBeUndefined();
    }
  });
});

describe('languages', () => {
  it.each([
    ['ms', 'Mula senaman'],
    ['ta', 'பயிற்சியைத் தொடங்கு'],
  ])('shows the session action in %s', async (language, text) => {
    await i18next.changeLanguage(language);

    const tree = await show();

    expect(shows(tree, text)).toBe(true);
    expect(shows(tree, 'Start workout')).toBe(false);
  });
});

describe('the guided session entry point', () => {
  it('offers the guided session on a workout day, for this plan and day, next to the regular workout', async () => {
    const tree = await show();

    const card = tree.root.findAll((n) => (n.type as unknown) === 'GuidedSessionCardStub')[0];
    expect(card.props).toMatchObject({ userId: 'A', planId: 'p', dayNumber: 18 });
    expect(count(tree, 'today-primary-action')).toBe(1); // the regular workout is still there
  });

  it('does not offer a guided session on a rest day', async () => {
    const tree = await show({ day: restDay() });

    expect(tree.root.findAll((n) => (n.type as unknown) === 'GuidedSessionCardStub')).toHaveLength(0);
  });
});

