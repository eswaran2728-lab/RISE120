import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import ProgressScreen from '../../../app/(tabs)/progress';
import i18next, { t } from '../../i18n';
import { loadProgress } from '../load';
import { loadHideBody, saveHideBody } from '../preferences';
import { loadUnits } from '../../profile/cache';
import type { ProgressInput } from '../selectors';

jest.setTimeout(30000);

const mockPush = jest.fn();

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return { useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]), useRouter: () => ({ push: mockPush }) };
});
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: { user: { id: 'A' } } }) }));
jest.mock('../../lib/useLocalDate', () => ({ useLocalDate: () => '2026-10-18' }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock('../load', () => ({ loadProgress: jest.fn() }));
jest.mock('../preferences', () => ({ loadHideBody: jest.fn(), saveHideBody: jest.fn() }));
jest.mock('../../profile/cache', () => ({ loadUnits: jest.fn() }));
jest.mock('../../checkin/photos', () => ({ getPhotoUrl: jest.fn().mockResolvedValue(null) }));

const mocked = { progress: loadProgress as jest.Mock, hide: loadHideBody as jest.Mock, saveHide: saveHideBody as jest.Mock, units: loadUnits as jest.Mock };

const progress = (over: Partial<ProgressInput> = {}): ProgressInput => ({
  userId: 'A',
  plan: { id: 'p', startDate: '2026-10-01', status: 'active' },
  days: [],
  today: '2026-10-18',
  exerciseNames: { squat: 'Goblet squat' },
  workoutLogs: [
    { id: 'p1', date: '2026-10-07', exerciseId: 'squat', reps: 10, weightKg: 20 },
    { id: 't1', date: '2026-10-13', exerciseId: 'squat', reps: 10, weightKg: 25 },
    { id: 't2', date: '2026-10-15', exerciseId: 'squat', reps: 10, weightKg: 25 },
  ],
  checkins: [
    { date: '2026-10-12', weightKg: 71, mood: 3, sleepHours: 7, photoPath: null },
    { date: '2026-10-18', weightKg: 70.2, mood: 3, sleepHours: 7, photoPath: null },
  ],
  pending: [],
  ...over,
});

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
async function mount() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<ProgressScreen />);
  });
  return tree;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await i18next.changeLanguage('en');
  mocked.progress.mockResolvedValue(progress());
  mocked.hide.mockResolvedValue(false);
  mocked.saveHide.mockResolvedValue(undefined);
  mocked.units.mockResolvedValue('metric');
});

describe('the last-7-days card on Progress', () => {
  it('shows days with a workout and a check-in as counts', async () => {
    const tree = await mount();

    expect(shows(tree, t('progress.week.title'))).toBe(true);
    expect(shows(tree, t('progress.week.workoutDays', { count: 2 }))).toBe(true);
    expect(shows(tree, t('progress.week.checkinDays', { count: 2 }))).toBe(true);
  });

  it('shows the strength comparison by exercise name, in words', async () => {
    const tree = await mount();

    expect(shows(tree, 'Goblet squat')).toBe(true);
    expect(shows(tree, t('progress.week.up'))).toBe(true);
  });

  it('says what the numbers are based on: only what was logged', async () => {
    const tree = await mount();

    expect(shows(tree, t('progress.week.onlyLogged'))).toBe(true);
  });

  it('warns when entries are still waiting to sync', async () => {
    mocked.progress.mockResolvedValue(progress({ pending: [{ kind: 'checkin', date: '2026-10-17', weightKg: 70, mood: 3, sleepHours: 7, photoUri: null, updatedAt: 1 } as never] }));
    const tree = await mount();

    expect(shows(tree, t('progress.week.pendingSync', { count: 1 }))).toBe(true);
  });

  it('describes an empty week as nothing logged, not as a failure', async () => {
    mocked.progress.mockResolvedValue(progress({ workoutLogs: [], checkins: [] }));
    const tree = await mount();

    expect(shows(tree, t('progress.week.noLogs'))).toBe(true);
    // The wording of the card itself (the calendar legend further down has its own words).
    const cardWords = ['title', 'noLogs', 'onlyLogged', 'noPrevious', 'nothingToCompare'].map((key) => t(`progress.week.${key}`)).join(' ');
    expect(cardWords).not.toMatch(/missed|failed|behind|lazy|skipped/i);
  });
});

describe('the buddy circle link', () => {
  it('opens the buddy screen from Progress', async () => {
    const tree = await mount();

    await act(async () => {
      byId(tree, 'progress-open-buddy')!.props.onPress();
    });

    expect(mockPush).toHaveBeenCalledWith('/buddy');
  });
});

describe('hiding weight and photos', () => {
  it('shows the weight chart and offers to hide it', async () => {
    const tree = await mount();

    expect(shows(tree, t('progress.weight'))).toBe(true);
    expect(shows(tree, t('progress.hideBody'))).toBe(true);
  });

  it('hides weight, photos and body figures and remembers the choice when asked', async () => {
    const tree = await mount();

    await act(async () => {
      await byId(tree, 'progress-hide-body')!.props.onPress();
    });

    expect(mocked.saveHide).toHaveBeenCalledWith('A', true);
    expect(shows(tree, t('progress.weight'))).toBe(false);
    expect(shows(tree, t('progress.photos'))).toBe(false);
    expect(shows(tree, t('progress.showBody'))).toBe(true);
    expect(textsOf(tree).join(' ')).not.toMatch(/71 kg|70\.2 kg/);
  });

  it('starts hidden when the member chose that before, and never flashes the weight first', async () => {
    mocked.hide.mockResolvedValue(true);
    const tree = await mount();

    expect(shows(tree, t('progress.weight'))).toBe(false);
    expect(shows(tree, t('progress.showBody'))).toBe(true);
  });

  it('shows everything again when asked', async () => {
    mocked.hide.mockResolvedValue(true);
    const tree = await mount();

    await act(async () => {
      await byId(tree, 'progress-hide-body')!.props.onPress();
    });

    expect(mocked.saveHide).toHaveBeenCalledWith('A', false);
    expect(shows(tree, t('progress.weight'))).toBe(true);
  });
});

describe('languages', () => {
  it.each(['ms', 'ta'])('shows the card in %s without a missing translation', async (language) => {
    await i18next.changeLanguage(language);
    const tree = await mount();

    expect(shows(tree, t('progress.week.title'))).toBe(true);
    expect(shows(tree, 'progress.week')).toBe(false);
  });
});
