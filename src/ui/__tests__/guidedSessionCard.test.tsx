import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { GuidedSessionCard } from '../GuidedSessionCard';
import { t } from '../../i18n';
import * as guided from '../../workout/guidedSession';
import * as sessions from '../../workout/sessions';
import type { CatalogueInput, ExerciseVersion, SessionTemplate } from '../../workout/catalogue';

jest.setTimeout(30000);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock('../../workout/guidedSession', () => ({ loadGuidedState: jest.fn() }));
jest.mock('../../workout/sessions', () => ({ startSession: jest.fn() }));

const load = guided.loadGuidedState as jest.Mock;
const start = sessions.startSession as jest.Mock;

const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'A. Coach', role: 'Certified strength coach', reviewedOn: '2026-10-10' };
const exercise = (id: string): ExerciseVersion => ({ id, version: 1, pattern: 'squat', equipment: 'none', name: L(id), cues: [L('one'), L('two')], regressions: [], alternatives: [], media: { kind: 'video', source: 'Rise120 Studio', licence: 'Owned by Rise120' }, reviewer, status: 'published' });
const template = (id: string, minutes: 10 | 20, over: Partial<SessionTemplate> = {}): SessionTemplate => ({
  id, version: 1, goal: 'recomp', level: 'beginner', minutes, location: 'home', dayType: 'training',
  exercises: [{ exerciseId: 'squat', sets: 3, reps: 10 }, { exerciseId: 'lunge', sets: 3, reps: 10 }, { exerciseId: 'plank', sets: 2, reps: 30 }, { exerciseId: 'row', sets: 2, reps: 10 }, { exerciseId: 'push', sets: 2, reps: 10 }].slice(0, minutes === 10 ? 2 : 5),
  reviewer, status: 'published', ...over,
});
const catalogue = (sessionsList: SessionTemplate[]): CatalogueInput => ({ exercises: ['squat', 'lunge', 'plank', 'row', 'push'].map(exercise), sessions: sessionsList });
const choose = (sessionsList = [template('quick', 10), template('standard', 20)]) => ({
  kind: 'choose' as const,
  catalogue: catalogue(sessionsList),
  profile: { equipment: 'none' as const, location: 'home' as const, goal: 'recomp' as const, level: 'beginner' as const },
});
const props = { userId: 'A', planId: 'plan-1', dayNumber: 5 };

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
async function mount(p = props) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<GuidedSessionCard {...p} />);
  });
  return tree;
}

beforeEach(() => {
  mockPush.mockReset();
  load.mockReset();
  start.mockReset();
  load.mockResolvedValue(choose());
});

describe('when there is nothing to offer', () => {
  it.each([
    ['no_catalogue', 'guided.unavailable'],
    ['no_links', 'guided.unavailable'],
  ])('says guided sessions are not available (%s), keeps the manual workout, and offers nothing to start', async (reason, key) => {
    load.mockResolvedValue({ kind: 'unavailable', reason });
    const tree = await mount();

    expect(shows(tree, t(key))).toBe(true);
    expect(byId(tree, 'guided-find')).toBeUndefined();
    expect(byId(tree, 'guided-start')).toBeUndefined();
    expect(start).not.toHaveBeenCalled();
  });

  it('offers a retry, not a dead end, when the state cannot be read', async () => {
    load.mockResolvedValueOnce({ kind: 'unavailable', reason: 'unreadable' });
    const tree = await mount();
    expect(shows(tree, t('guided.unreadable'))).toBe(true);

    await press(tree, 'guided-retry');

    expect(load).toHaveBeenCalledTimes(2);
    expect(byId(tree, 'guided-find')).toBeDefined();
  });
});

describe('choosing and starting', () => {
  it('asks for the plan and day it was given', async () => {
    await mount();

    expect(load).toHaveBeenCalledWith({ userId: 'A', planId: 'plan-1', dayNumber: 5 });
  });

  it('proposes the reviewed session that fits the time chosen, with a reason', async () => {
    const tree = await mount();
    await press(tree, 'guided-minutes-10');
    await press(tree, 'guided-find');

    expect(shows(tree, t('guided.proposal', { minutes: 10, count: 2 }))).toBe(true);
    expect(byId(tree, 'guided-start')).toBeDefined();
  });

  it('says plainly when no reviewed session fits, and nothing is invented', async () => {
    load.mockResolvedValue(choose([template('standard', 20)]));
    const tree = await mount();
    await press(tree, 'guided-minutes-10');
    await press(tree, 'guided-find');

    expect(shows(tree, t('guided.noMatch'))).toBe(true);
    expect(byId(tree, 'guided-start')).toBeUndefined();
  });

  it('starts the proposed session once, with a request id, and opens it', async () => {
    start.mockResolvedValue({ kind: 'started', sessionId: 'session-1', resumed: false, snapshot: {} });
    const tree = await mount();
    await press(tree, 'guided-minutes-10');
    await press(tree, 'guided-find');

    await press(tree, 'guided-start');

    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), planId: 'plan-1', dayNumber: 5, templateId: 'quick', templateVersion: 1 });
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/session', params: { sessionId: 'session-1' } });
  });

  it('starts only once however many times the button is tapped', async () => {
    let release!: (value: unknown) => void;
    start.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const tree = await mount();
    await press(tree, 'guided-find');

    await act(async () => {
      void byId(tree, 'guided-start')!.props.onPress();
      void byId(tree, 'guided-start')!.props.onPress();
    });
    await act(async () => release({ kind: 'started', sessionId: 'session-1', resumed: false, snapshot: {} }));

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('retries a start whose answer was lost with the same request id, so it cannot start two sessions', async () => {
    start.mockResolvedValueOnce({ kind: 'offline' });
    start.mockResolvedValueOnce({ kind: 'started', sessionId: 'session-1', resumed: true, snapshot: {} });
    const tree = await mount();
    await press(tree, 'guided-find');

    await press(tree, 'guided-start');
    expect(shows(tree, t('guided.startOffline'))).toBe(true);
    await press(tree, 'guided-start');

    expect(start.mock.calls[1][0].requestId).toBe(start.mock.calls[0][0].requestId);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['day_not_available', 'guided.dayNotAvailable'],
    ['template_unavailable', 'guided.templateGone'],
    ['plan_not_found', 'guided.startError'],
    ['invalid', 'guided.startError'],
    ['error', 'guided.startError'],
  ])('explains a refused start (%s) and does not navigate', async (kind, key) => {
    start.mockResolvedValue({ kind });
    const tree = await mount();
    await press(tree, 'guided-find');

    await press(tree, 'guided-start');

    expect(shows(tree, t(key))).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('resuming and finishing', () => {
  it('opens the session already under way instead of offering a second one', async () => {
    load.mockResolvedValue({ kind: 'active', sessionId: 'session-9' });
    const tree = await mount();

    expect(byId(tree, 'guided-find')).toBeUndefined();
    await press(tree, 'guided-resume');

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/session', params: { sessionId: 'session-9' } });
  });

  it('shows a finished session as done, with a way to look at it, and no new start', async () => {
    load.mockResolvedValue({ kind: 'done', sessionId: 'session-9' });
    const tree = await mount();

    expect(shows(tree, t('guided.done'))).toBe(true);
    expect(byId(tree, 'guided-find')).toBeUndefined();
    await press(tree, 'guided-view');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/session', params: { sessionId: 'session-9' } });
  });
});

describe('account isolation', () => {
  it('never shows the previous accounts session after the account changes, even if its answer arrives late', async () => {
    let releaseA!: (value: unknown) => void;
    load.mockImplementation(({ userId }: { userId: string }) =>
      userId === 'A' ? new Promise((resolve) => (releaseA = resolve)) : Promise.resolve({ kind: 'unavailable', reason: 'no_catalogue' })
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<GuidedSessionCard {...props} userId="A" />);
    });

    await act(async () => {
      tree.update(<GuidedSessionCard {...props} userId="B" />);
    });
    await act(async () => releaseA({ kind: 'active', sessionId: 'session-of-A' }));

    expect(byId(tree, 'guided-resume')).toBeUndefined();
    expect(shows(tree, t('guided.unavailable'))).toBe(true);
  });

  it('shows nothing of the previous account while the new account is still loading', async () => {
    load.mockImplementation(({ userId }: { userId: string }) => (userId === 'A' ? Promise.resolve({ kind: 'active', sessionId: 'session-of-A' }) : new Promise(() => undefined)));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<GuidedSessionCard {...props} userId="A" />);
    });
    expect(byId(tree, 'guided-resume')).toBeDefined();

    await act(async () => {
      tree.update(<GuidedSessionCard {...props} userId="B" />);
    });

    expect(byId(tree, 'guided-resume')).toBeUndefined();
    expect(shows(tree, t('states.loading'))).toBe(true);
  });
});

