import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import CoachScreen from '../../../app/(tabs)/coach';
import i18next, { t } from '../../i18n';
import { decideProposal, loadHistory, sendCoachMessage } from '../api';
import { loadLimitsOrCached, LimitSnapshot } from '../../monetization/limits';
import { useUnlock } from '../../monetization/useUnlock';
import { loadPlanBundle, refreshPlanBundle } from '../../plan/planData';
import { clearCache, readCache, writeCache } from '../../cache/userCache';
import { enqueue } from '../../sync/queue';
import type { CoachExchange, CoachProposal } from '../types';

jest.setTimeout(30000); // the first render of the screen pays for loading the React Native modules

let mockUserId: string | null = 'A';
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return { useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]), useRouter: () => ({ push: jest.fn() }) };
});
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: mockUserId ? { user: { id: mockUserId } } : null }) }));
jest.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() }, from: jest.fn() } }));
jest.mock('../api');
jest.mock('../../monetization/limits', () => ({ ...jest.requireActual('../../monetization/limits'), loadLimitsOrCached: jest.fn() }));
jest.mock('../../monetization/useUnlock', () => ({ useUnlock: jest.fn() }));
jest.mock('../../plan/planData', () => ({ loadPlanBundle: jest.fn(), refreshPlanBundle: jest.fn() }));
jest.mock('../../cache/userCache', () => ({ readCache: jest.fn(), writeCache: jest.fn(), clearCache: jest.fn() }));
jest.mock('../../sync/queue', () => ({ enqueue: jest.fn() }));

const mocked = {
  send: sendCoachMessage as jest.Mock,
  decide: decideProposal as jest.Mock,
  history: loadHistory as jest.Mock,
  limits: loadLimitsOrCached as jest.Mock,
  plan: loadPlanBundle as jest.Mock,
  refresh: refreshPlanBundle as jest.Mock,
  read: readCache as jest.Mock,
  write: writeCache as jest.Mock,
  clear: clearCache as jest.Mock,
  unlock: useUnlock as jest.Mock,
};

const snapshot = (over: { tier?: 'free' | 'premium'; used?: number; base?: number | null; bonus?: number; remaining?: number | null; adsRemaining?: number } = {}): LimitSnapshot => {
  const premium = over.tier === 'premium';
  return {
    tier: over.tier ?? 'free',
    quotaDayUtc: '2026-10-18',
    resetsAt: '2026-10-19T00:00:00.000Z',
    planDaysAccessible: premium ? 120 : 14,
    food: { used: 0, base: 3, bonus: 0, remaining: 3 },
    ai: premium
      ? { used: over.used ?? 0, base: null, bonus: 0, remaining: null }
      : { used: over.used ?? 0, base: over.base ?? 1, bonus: over.bonus ?? 0, remaining: over.remaining ?? 1 },
    adRewards: { used: 0, max: 3, remaining: over.adsRemaining ?? 3 },
  };
};
const fresh = (s: LimitSnapshot) => ({ snapshot: s, stale: false });

const rest = { kind: 'rest' as const };
const expected = { workout: rest, calorieTarget: 2650, proteinTargetG: 125 };
const pending = (id = 'p1', status: CoachProposal['status'] = 'pending'): CoachProposal => ({
  id,
  status,
  patches: [{ dayNumber: 5, expected, next: { calorieTarget: 2750, proteinTargetG: 130 } }],
});
const exchange = (id: string, over: Partial<CoachExchange> = {}): CoachExchange => ({
  requestId: `00000000-0000-4000-8000-00000000000${id}`, messageId: `m${id}`, message: `question ${id}`, reply: `answer ${id}`, language: 'en', createdAt: null, proposal: null, ...over,
});
const answered = (e: CoachExchange, extra: Record<string, unknown> = {}) => ({ kind: 'answered', exchange: e, refused: false, proposalDropped: false, ...extra });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const idOf = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string')[0];
const maybe = (tree: ReactTestRenderer, id: string) => idOf(tree, id);
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
  const node = idOf(tree, id);
  await act(async () => {
    await node.props.onPress();
  });
};
const typeIn = async (tree: ReactTestRenderer, text: string) => {
  await act(async () => {
    idOf(tree, 'coach-input').props.onChangeText(text);
  });
};
const pressText = async (tree: ReactTestRenderer, label: string) => {
  const target = tree.root.findAll((n) => typeof n.props.onPress === 'function' && n.findAll((m) => m.children.includes(label)).length > 0)[0];
  await act(async () => {
    await target.props.onPress();
  });
};
async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<CoachScreen />);
  });
  return tree;
}
const switchTo = async (tree: ReactTestRenderer, userId: string) => {
  mockUserId = userId;
  await act(async () => {
    tree.update(<CoachScreen />);
  });
};

const bundle = {
  plan: { id: 'plan', startDate: '2026-10-16', status: 'active' },
  days: [],
  exercises: [{ id: 'e1', name: 'Barbell squat', muscleGroup: 'squat', equipment: 'gym', instructions: '' }],
};

let unlockRun: jest.Mock;
let unlockOptions: { rewardType: string; onChanged?: () => void };

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'A';
  mocked.history.mockResolvedValue([]);
  mocked.limits.mockResolvedValue(fresh(snapshot()));
  mocked.plan.mockResolvedValue(bundle);
  mocked.refresh.mockResolvedValue(bundle);
  mocked.read.mockResolvedValue(null);
  mocked.write.mockResolvedValue(undefined);
  mocked.clear.mockResolvedValue(undefined);
  unlockRun = jest.fn();
  mocked.unlock.mockImplementation((options) => {
    unlockOptions = options;
    return { run: unlockRun, busy: false, messageKey: null };
  });
});

describe('history', () => {
  it('shows a loading state, then the empty state', async () => {
    const pendingHistory = deferred<CoachExchange[]>();
    mocked.history.mockReturnValue(pendingHistory.promise);

    const tree = await mount();
    expect(shows(tree, t('coach.loadingHistory'))).toBe(true);

    await act(async () => pendingHistory.resolve([]));
    expect(shows(tree, t('coach.loadingHistory'))).toBe(false);
    expect(shows(tree, t('coach.empty'))).toBe(true);
  });

  it('shows saved exchanges oldest first, with the privacy and safety notes', async () => {
    mocked.history.mockResolvedValue([exchange('1'), exchange('2')]);

    const tree = await mount();

    const all = textsOf(tree).join('|');
    expect(all.indexOf('question 1')).toBeLessThan(all.indexOf('answer 1'));
    expect(all.indexOf('answer 1')).toBeLessThan(all.indexOf('question 2'));
    expect(shows(tree, t('coach.safetyNote'))).toBe(true);
    expect(shows(tree, t('coach.contextNote'))).toBe(true);
  });

  it('remembers the history on the phone for this account', async () => {
    mocked.history.mockResolvedValue([exchange('1')]);

    await mount();

    expect(mocked.write).toHaveBeenCalledWith('A', 'coach', [exchange('1')]);
  });

  it('shows the saved history with an offline notice when the server cannot be read', async () => {
    mocked.history.mockRejectedValue(new Error('offline'));
    mocked.read.mockImplementation(async (user: string, name: string) => (user === 'A' && name === 'coach' ? [exchange('1')] : null));

    const tree = await mount();

    expect(shows(tree, 'question 1')).toBe(true);
    expect(shows(tree, t('coach.offlineHistory'))).toBe(true);
    expect(shows(tree, t('coach.historyError'))).toBe(false);
  });

  it('shows an error with Try again when there is nothing saved either, and Try again reloads', async () => {
    mocked.history.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([exchange('1')]);

    const tree = await mount();
    expect(shows(tree, t('coach.historyError'))).toBe(true);

    await press(tree, 'coach-retry-history');

    expect(shows(tree, 'question 1')).toBe(true);
    expect(shows(tree, t('coach.historyError'))).toBe(false);
  });
});

describe('allowance from the server', () => {
  it('shows how many messages were used out of how many are allowed today', async () => {
    mocked.limits.mockResolvedValue(fresh(snapshot({ used: 1, base: 1, bonus: 1, remaining: 1 })));

    const tree = await mount();

    expect(shows(tree, `${t('coach.allowanceLabel')}: 1 / 2`)).toBe(true);
  });

  it('shows unlimited for a premium member, with no limit notice or ad choice', async () => {
    mocked.limits.mockResolvedValue(fresh(snapshot({ tier: 'premium', used: 5 })));

    const tree = await mount();

    expect(shows(tree, `${t('coach.allowanceLabel')}: ${t('limits.unlimited')}`)).toBe(true);
    expect(shows(tree, t('coach.limitReached'))).toBe(false);
    expect(shows(tree, t('limits.watchAd'))).toBe(false);
  });

  it('explains an used-up allowance with the reset time and offers Subscribe and Watch ad', async () => {
    mocked.limits.mockResolvedValue(fresh(snapshot({ used: 1, remaining: 0 })));

    const tree = await mount();

    expect(shows(tree, t('coach.limitReached'))).toBe(true);
    expect(shows(tree, t('limits.resetsAt'))).toBe(true);
    expect(shows(tree, t('limits.subscribe'))).toBe(true);
    expect(shows(tree, t('limits.watchAd'))).toBe(true);
  });

  it('reuses the verified rewarded-ad flow for AI messages: it starts the ad and reloads the allowance afterwards', async () => {
    mocked.limits.mockResolvedValue(fresh(snapshot({ used: 1, remaining: 0 })));
    const tree = await mount();

    expect(unlockOptions.rewardType).toBe('ai');
    await pressText(tree, t('limits.watchAd'));
    expect(unlockRun).toHaveBeenCalledWith('watch_ad');

    const before = mocked.limits.mock.calls.length;
    await act(async () => unlockOptions.onChanged?.());
    expect(mocked.limits.mock.calls.length).toBeGreaterThan(before);
  });

  it('does not offer the ad when the server says no ad rewards remain', async () => {
    mocked.limits.mockResolvedValue(fresh(snapshot({ used: 1, remaining: 0, adsRemaining: 0 })));

    const tree = await mount();

    expect(shows(tree, t('limits.watchAd'))).toBe(false);
    expect(shows(tree, t('limits.subscribe'))).toBe(true);
  });

  it('still lets the server decide: Send stays enabled even when the allowance looks used up', async () => {
    mocked.limits.mockResolvedValue(fresh(snapshot({ used: 1, remaining: 0 })));

    const tree = await mount();
    await typeIn(tree, 'hello');

    expect(idOf(tree, 'coach-send').props.disabled).toBeFalsy();
  });

  it('says the allowance may be out of date when it comes from the phone\'s memory', async () => {
    mocked.limits.mockResolvedValue({ snapshot: snapshot(), stale: true });

    const tree = await mount();

    expect(shows(tree, t('limits.lastKnown'))).toBe(true);
  });
});

describe('sending', () => {
  it('sends the typed message under a new request id, shows the reply, clears the box, and reloads the allowance', async () => {
    mocked.send.mockImplementation(async (requestId: string, message: string) => answered(exchange('1', { requestId, message, reply: 'Rest well.' })));
    const tree = await mount();
    const limitCalls = mocked.limits.mock.calls.length;

    await typeIn(tree, '  How is my week?  ');
    await press(tree, 'coach-send');

    expect(mocked.send).toHaveBeenCalledTimes(1);
    const [requestId, message] = mocked.send.mock.calls[0];
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(message).toBe('How is my week?');
    expect(shows(tree, 'Rest well.')).toBe(true);
    expect(idOf(tree, 'coach-input').props.value).toBe('');
    expect(mocked.limits.mock.calls.length).toBeGreaterThan(limitCalls);
  });

  it('does not send an empty message', async () => {
    const tree = await mount();

    await typeIn(tree, '   ');

    expect(idOf(tree, 'coach-send').props.disabled).toBe(true);
    await press(tree, 'coach-send');
    expect(mocked.send).not.toHaveBeenCalled();
  });

  it('sends once when Send is tapped twice quickly, and shows a sending state', async () => {
    const reply = deferred<unknown>();
    mocked.send.mockReturnValue(reply.promise);
    const tree = await mount();
    await typeIn(tree, 'hello');

    await act(async () => {
      idOf(tree, 'coach-send').props.onPress();
      idOf(tree, 'coach-send').props.onPress();
    });

    expect(mocked.send).toHaveBeenCalledTimes(1);
    expect(shows(tree, t('coach.sending'))).toBe(true);
    expect(idOf(tree, 'coach-send').props.disabled).toBe(true);

    await act(async () => reply.resolve(answered(exchange('1'))));
    expect(mocked.send).toHaveBeenCalledTimes(1);
  });

  it('shows the note when the coach could not make a safe plan change', async () => {
    mocked.send.mockImplementation(async (requestId: string, message: string) => answered(exchange('1', { requestId, message }), { proposalDropped: true }));
    const tree = await mount();
    await typeIn(tree, 'hello');

    await press(tree, 'coach-send');

    expect(shows(tree, t('coach.proposalDropped'))).toBe(true);
  });

  it('never queues a message: nothing is written to the sync queue, even when offline', async () => {
    mocked.send.mockResolvedValue({ kind: 'offline' });
    const tree = await mount();
    await typeIn(tree, 'hello');

    await press(tree, 'coach-send');

    expect(enqueue).not.toHaveBeenCalled();
    expect(shows(tree, t('coach.offline'))).toBe(true);
    expect(idOf(tree, 'coach-input').props.value).toBe('hello');
  });
});

describe('request ids and retries', () => {
  const requestIdOf = (call: number) => mocked.send.mock.calls[call][0] as string;

  it('keeps the same request id when an offline send is checked again, and the message is the same', async () => {
    mocked.send.mockResolvedValueOnce({ kind: 'offline' }).mockImplementation(async (requestId: string, message: string) => answered(exchange('1', { requestId, message })));
    const tree = await mount();
    await typeIn(tree, 'hello');
    await press(tree, 'coach-send');
    expect(shows(tree, t('coach.checkAgain'))).toBe(true);

    await press(tree, 'coach-check-again');

    expect(mocked.send).toHaveBeenCalledTimes(2);
    expect(requestIdOf(1)).toBe(requestIdOf(0));
    expect(mocked.send.mock.calls[1][1]).toBe('hello');
    expect(shows(tree, 'answer 1')).toBe(true);
  });

  it('keeps the request id after an unknown outcome, and creating a new request is a separate explicit action', async () => {
    mocked.send.mockResolvedValue({ kind: 'unknown_outcome' });
    const tree = await mount();
    await typeIn(tree, 'hello');
    await press(tree, 'coach-send');
    expect(shows(tree, t('coach.unknownOutcome'))).toBe(true);

    await press(tree, 'coach-check-again');
    expect(requestIdOf(1)).toBe(requestIdOf(0));

    await press(tree, 'coach-ask-again');
    expect(mocked.send).toHaveBeenCalledTimes(3);
    expect(requestIdOf(2)).not.toBe(requestIdOf(0));
    expect(mocked.send.mock.calls[2][1]).toBe('hello');
  });

  it('keeps the request id when the same message is sent again after a rate limit, a limit or a known failure', async () => {
    mocked.send
      .mockResolvedValueOnce({ kind: 'unavailable' })
      .mockResolvedValueOnce({ kind: 'limit', resetsAt: '2026-10-19T00:00:00.000Z' })
      .mockResolvedValueOnce({ kind: 'invalid' });
    const tree = await mount();
    await typeIn(tree, 'hello');

    await press(tree, 'coach-send');
    await press(tree, 'coach-send');
    await press(tree, 'coach-send');

    expect(new Set(mocked.send.mock.calls.map((c) => c[0])).size).toBe(1);
  });

  it('uses a new request id when the message is edited after a failure', async () => {
    mocked.send.mockResolvedValue({ kind: 'unavailable' });
    const tree = await mount();
    await typeIn(tree, 'hello');
    await press(tree, 'coach-send');

    await typeIn(tree, 'hello, and one more thing');
    await press(tree, 'coach-send');

    expect(requestIdOf(1)).not.toBe(requestIdOf(0));
  });

  it('uses a new request id for a new message after a success', async () => {
    mocked.send.mockImplementation(async (requestId: string, message: string) => answered(exchange('1', { requestId, message })));
    const tree = await mount();
    await typeIn(tree, 'first');
    await press(tree, 'coach-send');
    await typeIn(tree, 'second');
    await press(tree, 'coach-send');

    expect(requestIdOf(1)).not.toBe(requestIdOf(0));
  });

  it('never repeats a provider call by itself: no automatic retry after any failure, however long it waits', async () => {
    jest.useFakeTimers();
    try {
      for (const result of [{ kind: 'offline' }, { kind: 'unknown_outcome' }, { kind: 'in_progress' }, { kind: 'unavailable' }]) {
        mocked.send.mockReset();
        mocked.send.mockResolvedValue(result);
        const tree = await mount();
        await typeIn(tree, 'hello');
        await press(tree, 'coach-send');

        await act(async () => {
          jest.advanceTimersByTime(10 * 60 * 1000);
        });

        expect(mocked.send).toHaveBeenCalledTimes(1);
        await act(async () => tree.unmount());
      }
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('server answers that stop a send', () => {
  it('keeps the draft and shows the limit notice with the reset time and ad choices on AI_LIMIT_REACHED, and reloads the allowance', async () => {
    mocked.send.mockResolvedValue({ kind: 'limit', resetsAt: '2026-10-19T00:00:00.000Z' });
    const tree = await mount();
    const before = mocked.limits.mock.calls.length;
    await typeIn(tree, 'hello');

    await press(tree, 'coach-send');

    expect(idOf(tree, 'coach-input').props.value).toBe('hello');
    expect(shows(tree, t('coach.limitReached'))).toBe(true);
    expect(shows(tree, t('limits.watchAd'))).toBe(true);
    expect(mocked.limits.mock.calls.length).toBeGreaterThan(before);
  });

  it('shows the rate limit with a countdown from the server retry time, blocks Send until then, and does not retry by itself', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-10-18T10:00:00Z'));
      mocked.send.mockResolvedValue({ kind: 'rate_limited', retryAt: '2026-10-18T10:00:30.000Z' });
      const tree = await mount();
      await typeIn(tree, 'hello');
      await press(tree, 'coach-send');

      expect(shows(tree, t('coach.rateLimited'))).toBe(true);
      expect(shows(tree, `${t('coach.tryAgainIn')} 30`)).toBe(true);
      expect(idOf(tree, 'coach-send').props.disabled).toBe(true);

      await act(async () => {
        jest.advanceTimersByTime(12 * 1000);
      });
      expect(shows(tree, `${t('coach.tryAgainIn')} 18`)).toBe(true);
      expect(idOf(tree, 'coach-send').props.disabled).toBe(true);

      await act(async () => {
        jest.advanceTimersByTime(19 * 1000);
      });
      expect(idOf(tree, 'coach-send').props.disabled).toBeFalsy();
      expect(mocked.send).toHaveBeenCalledTimes(1); // waiting never re-sends

      mocked.send.mockResolvedValue(answered(exchange('1')));
      await press(tree, 'coach-send'); // an explicit tap does
      expect(mocked.send).toHaveBeenCalledTimes(2);
      expect(mocked.send.mock.calls[1][0]).toBe(mocked.send.mock.calls[0][0]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('says a request is still being answered, offering to check again with the same id and never starting a new one', async () => {
    mocked.send.mockResolvedValueOnce({ kind: 'in_progress' }).mockImplementation(async (requestId: string, message: string) => answered(exchange('1', { requestId, message })));
    const tree = await mount();
    await typeIn(tree, 'hello');

    await press(tree, 'coach-send');
    expect(shows(tree, t('coach.inProgress'))).toBe(true);
    expect(maybe(tree, 'coach-ask-again')).toBeUndefined();

    await press(tree, 'coach-check-again');
    expect(mocked.send.mock.calls[1][0]).toBe(mocked.send.mock.calls[0][0]);
    expect(shows(tree, 'answer 1')).toBe(true);
  });

  it.each([
    ['unavailable', 'coach.unavailable'],
    ['invalid', 'coach.invalid'],
    ['error', 'coach.error'],
    ['offline', 'coach.offline'],
  ])('shows a translated message for %s and keeps the draft', async (kind, key) => {
    mocked.send.mockResolvedValue({ kind });
    const tree = await mount();
    await typeIn(tree, 'hello');

    await press(tree, 'coach-send');

    expect(shows(tree, t(key))).toBe(true);
    expect(idOf(tree, 'coach-input').props.value).toBe('hello');
  });

  it('shows no raw translation keys anywhere', async () => {
    mocked.send.mockResolvedValue({ kind: 'unknown_outcome' });
    mocked.history.mockResolvedValue([exchange('1', { proposal: pending() })]);
    const tree = await mount();
    await typeIn(tree, 'hello');
    await press(tree, 'coach-send');

    expect(textsOf(tree).filter((s) => /^(coach|limits|tabs|errors)\.[a-zA-Z.]+$/.test(s))).toEqual([]);
  });
});

describe('proposals', () => {
  const withProposal = (status: CoachProposal['status'] = 'pending') => mocked.history.mockResolvedValue([exchange('1', { proposal: pending('p1', status) })]);

  it('shows the affected day and date, the exact before and after values, and Accept and Decline', async () => {
    withProposal();

    const tree = await mount();

    expect(shows(tree, t('coach.proposal.title'))).toBe(true);
    expect(shows(tree, '2026-10-20')).toBe(true); // plan day 5 of a plan that started 2026-10-16
    expect(shows(tree, `${t('coach.proposal.calories')}: 2650 → 2750`)).toBe(true);
    expect(shows(tree, `${t('coach.proposal.protein')}: 125 → 130`)).toBe(true);
    expect(shows(tree, t('coach.proposal.notChangedUntil'))).toBe(true);
    expect(maybe(tree, 'coach-accept-p1')).toBeDefined();
    expect(maybe(tree, 'coach-decline-p1')).toBeDefined();
  });

  it('shows workout changes with exercise names and sets and reps before and after', async () => {
    const proposal: CoachProposal = {
      id: 'pw',
      status: 'pending',
      patches: [
        {
          dayNumber: 5,
          expected: { workout: { kind: 'workout', exercises: [{ exercise_id: 'e1', sets: 2, reps: 10 }] }, calorieTarget: 2650, proteinTargetG: 125 },
          next: { workout: { kind: 'workout', exercises: [{ exercise_id: 'e1', sets: 3, reps: 12 }] } },
        },
      ],
    };
    mocked.history.mockResolvedValue([exchange('1', { proposal })]);

    const tree = await mount();

    expect(shows(tree, 'Barbell squat 2 × 10 → Barbell squat 3 × 12')).toBe(true);
  });

  it.each([
    ['accepted', 'coach.proposal.accepted'],
    ['declined', 'coach.proposal.declined'],
    ['stale', 'coach.proposal.stale'],
  ] as const)('shows a %s proposal as such, without Accept or Decline', async (status, key) => {
    withProposal(status);

    const tree = await mount();

    expect(shows(tree, t(key))).toBe(true);
    expect(maybe(tree, 'coach-accept-p1')).toBeUndefined();
    expect(maybe(tree, 'coach-decline-p1')).toBeUndefined();
  });

  it('accepts: sends only the proposal id and decision, then drops the old plan copy before reading the new one', async () => {
    withProposal();
    mocked.decide.mockResolvedValue({ kind: 'accepted', changedDays: [5] });
    const order: string[] = [];
    mocked.clear.mockImplementation(async () => void order.push('clear'));
    mocked.refresh.mockImplementation(async () => {
      order.push('refresh');
      return bundle;
    });
    const tree = await mount();

    await press(tree, 'coach-accept-p1');

    expect(mocked.decide).toHaveBeenCalledWith('p1', 'accept');
    expect(shows(tree, t('coach.proposal.accepted'))).toBe(true);
    expect(mocked.clear).toHaveBeenCalledWith('A', 'plan');
    expect(mocked.refresh).toHaveBeenCalledWith('A');
    expect(order).toEqual(['clear', 'refresh']);
    expect(maybe(tree, 'coach-accept-p1')).toBeUndefined();
  });

  it('records the accepted status in the saved history', async () => {
    withProposal();
    mocked.decide.mockResolvedValue({ kind: 'accepted', changedDays: [5] });
    const tree = await mount();
    mocked.write.mockClear();

    await press(tree, 'coach-accept-p1');

    const saved = mocked.write.mock.calls.filter((c) => c[1] === 'coach').pop();
    expect(saved?.[2][0].proposal.status).toBe('accepted');
  });

  it('decides once when Accept is tapped twice quickly', async () => {
    withProposal();
    const result = deferred<unknown>();
    mocked.decide.mockReturnValue(result.promise);
    const tree = await mount();

    await act(async () => {
      idOf(tree, 'coach-accept-p1').props.onPress();
      idOf(tree, 'coach-accept-p1').props.onPress();
      idOf(tree, 'coach-decline-p1').props.onPress();
    });

    expect(mocked.decide).toHaveBeenCalledTimes(1);
    expect(shows(tree, t('coach.proposal.deciding'))).toBe(true);
    await act(async () => result.resolve({ kind: 'accepted', changedDays: [5] }));
    expect(mocked.decide).toHaveBeenCalledTimes(1);
  });

  it('declines without touching the plan or its cache', async () => {
    withProposal();
    mocked.decide.mockResolvedValue({ kind: 'declined' });
    const tree = await mount();

    await press(tree, 'coach-decline-p1');

    expect(mocked.decide).toHaveBeenCalledWith('p1', 'decline');
    expect(shows(tree, t('coach.proposal.declined'))).toBe(true);
    expect(mocked.clear).not.toHaveBeenCalled();
    expect(mocked.refresh).not.toHaveBeenCalled();
  });

  it('shows a stale proposal as out of date and leaves the plan cache alone', async () => {
    withProposal();
    mocked.decide.mockResolvedValue({ kind: 'stale' });
    const tree = await mount();

    await press(tree, 'coach-accept-p1');

    expect(shows(tree, t('coach.proposal.stale'))).toBe(true);
    expect(mocked.clear).not.toHaveBeenCalled();
    expect(mocked.refresh).not.toHaveBeenCalled();
  });

  it('reloads the real state when the server reports a conflicting earlier decision', async () => {
    withProposal();
    mocked.decide.mockResolvedValue({ kind: 'conflict', current: 'declined' });
    const tree = await mount();
    mocked.history.mockResolvedValue([exchange('1', { proposal: pending('p1', 'declined') })]);

    await press(tree, 'coach-accept-p1');

    expect(shows(tree, t('coach.proposal.declined'))).toBe(true);
    expect(mocked.refresh).not.toHaveBeenCalled();
  });

  it.each([['offline'], ['error']])('keeps Accept and Decline and shows a retryable message when the decision fails (%s)', async (kind) => {
    withProposal();
    mocked.decide.mockResolvedValueOnce({ kind }).mockResolvedValueOnce({ kind: 'declined' });
    const tree = await mount();

    await press(tree, 'coach-decline-p1');
    expect(shows(tree, t('coach.proposal.decisionError'))).toBe(true);
    expect(maybe(tree, 'coach-decline-p1')).toBeDefined();

    await press(tree, 'coach-decline-p1');
    expect(shows(tree, t('coach.proposal.declined'))).toBe(true);
    expect(shows(tree, t('coach.proposal.decisionError'))).toBe(false);
  });

  describe('when refreshing the plan after an acceptance fails', () => {
    it('keeps the accepted decision visible, says the plan was not refreshed, and never says the old values are current', async () => {
      withProposal();
      mocked.decide.mockResolvedValue({ kind: 'accepted', changedDays: [5] });
      mocked.refresh.mockRejectedValue(new Error('offline'));
      const tree = await mount();

      await press(tree, 'coach-accept-p1');

      expect(shows(tree, t('coach.proposal.accepted'))).toBe(true);
      expect(shows(tree, t('coach.proposal.refreshFailed'))).toBe(true);
      expect(maybe(tree, 'coach-refresh-plan')).toBeDefined();
      expect(shows(tree, t('coach.proposal.refreshed'))).toBe(false);
      expect(mocked.clear).toHaveBeenCalledWith('A', 'plan'); // the old copy is gone, not kept as if current
    });

    it('offers Refresh plan, which retries only the refresh and never the decision', async () => {
      withProposal();
      mocked.decide.mockResolvedValue({ kind: 'accepted', changedDays: [5] });
      mocked.refresh.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(bundle);
      const tree = await mount();
      await press(tree, 'coach-accept-p1');

      await press(tree, 'coach-refresh-plan');

      expect(mocked.refresh).toHaveBeenCalledTimes(2);
      expect(mocked.decide).toHaveBeenCalledTimes(1);
      expect(maybe(tree, 'coach-refresh-plan')).toBeUndefined();
      expect(shows(tree, t('coach.proposal.refreshFailed'))).toBe(false);
      expect(shows(tree, t('coach.proposal.refreshed'))).toBe(true);
    });

    it('shows an updating state while the refresh runs', async () => {
      withProposal();
      mocked.decide.mockResolvedValue({ kind: 'accepted', changedDays: [5] });
      const refresh = deferred<unknown>();
      mocked.refresh.mockReturnValue(refresh.promise);
      const tree = await mount();

      await press(tree, 'coach-accept-p1');
      expect(shows(tree, t('coach.proposal.refreshing'))).toBe(true);

      await act(async () => refresh.resolve(bundle));
      expect(shows(tree, t('coach.proposal.refreshing'))).toBe(false);
    });
  });
});

describe('switching accounts', () => {
  it('shows the new account\'s own history and saved copy, never the previous one\'s', async () => {
    mocked.history.mockImplementation(async (user: string) => [exchange(user === 'A' ? '1' : '2', { message: `message of ${user}` })]);
    const tree = await mount();
    expect(shows(tree, 'message of A')).toBe(true);

    await switchTo(tree, 'B');

    expect(shows(tree, 'message of B')).toBe(true);
    expect(shows(tree, 'message of A')).toBe(false);
  });

  it('ignores account A\'s history that arrives after switching to B', async () => {
    const slowA = deferred<CoachExchange[]>();
    mocked.history.mockImplementation((user: string) => (user === 'A' ? slowA.promise : Promise.resolve([exchange('2', { message: 'message of B' })])));
    const tree = await mount();

    await switchTo(tree, 'B');
    await act(async () => slowA.resolve([exchange('1', { message: 'message of A' })]));

    expect(shows(tree, 'message of B')).toBe(true);
    expect(shows(tree, 'message of A')).toBe(false);
    expect(mocked.write.mock.calls.filter((c) => c[0] === 'B').every((c) => !JSON.stringify(c[2]).includes('message of A'))).toBe(true);
  });

  it('ignores account A\'s coach reply that arrives after switching to B, and leaves B\'s box and allowance alone', async () => {
    const reply = deferred<unknown>();
    mocked.send.mockReturnValue(reply.promise);
    const tree = await mount();
    await typeIn(tree, 'a private question from A');
    await press(tree, 'coach-send');

    await switchTo(tree, 'B');
    expect(idOf(tree, 'coach-input').props.value).toBe('');
    expect(idOf(tree, 'coach-send').props.disabled).toBe(true); // B has typed nothing yet, and A's send is not B's

    await act(async () => reply.resolve(answered(exchange('1', { message: 'a private question from A', reply: 'a private answer for A' }))));

    expect(shows(tree, 'a private answer for A')).toBe(false);
    expect(shows(tree, 'a private question from A')).toBe(false);
    expect(mocked.write.mock.calls.filter((c) => c[0] === 'B').every((c) => !JSON.stringify(c[2]).includes('private'))).toBe(true);
  });

  it('lets account B send at once while A\'s request is still running', async () => {
    mocked.send.mockReturnValueOnce(deferred<unknown>().promise).mockImplementation(async (requestId: string, message: string) => answered(exchange('2', { requestId, message, reply: 'answer for B' })));
    const tree = await mount();
    await typeIn(tree, 'from A');
    await press(tree, 'coach-send');

    await switchTo(tree, 'B');
    await typeIn(tree, 'from B');
    await press(tree, 'coach-send');

    expect(mocked.send).toHaveBeenCalledTimes(2);
    expect(shows(tree, 'answer for B')).toBe(true);
  });

  it('ignores account A\'s failure state after switching: B sees no error or retry buttons', async () => {
    const reply = deferred<unknown>();
    mocked.send.mockReturnValue(reply.promise);
    const tree = await mount();
    await typeIn(tree, 'from A');
    await press(tree, 'coach-send');
    await switchTo(tree, 'B');

    await act(async () => reply.resolve({ kind: 'unknown_outcome' }));

    expect(shows(tree, t('coach.unknownOutcome'))).toBe(false);
    expect(maybe(tree, 'coach-check-again')).toBeUndefined();
  });

  it('ignores account A\'s allowance that arrives after switching', async () => {
    const slowA = deferred<unknown>();
    mocked.limits.mockImplementation((user: string) => (user === 'A' ? slowA.promise : Promise.resolve(fresh(snapshot({ used: 0, base: 1, remaining: 1 })))));
    const tree = await mount();

    await switchTo(tree, 'B');
    await act(async () => slowA.resolve(fresh(snapshot({ tier: 'premium' }))));

    expect(shows(tree, `${t('coach.allowanceLabel')}: ${t('limits.unlimited')}`)).toBe(false);
    expect(shows(tree, `${t('coach.allowanceLabel')}: 0 / 1`)).toBe(true);
  });

  it('applies account A\'s late decision to A\'s data only: B\'s view is untouched and no plan is read for A under B', async () => {
    mocked.history.mockImplementation(async (user: string) => (user === 'A' ? [exchange('1', { proposal: pending('p1') })] : [exchange('2')]));
    const decision = deferred<unknown>();
    mocked.decide.mockReturnValue(decision.promise);
    const tree = await mount();
    await press(tree, 'coach-accept-p1');

    await switchTo(tree, 'B');
    await act(async () => decision.resolve({ kind: 'accepted', changedDays: [5] }));

    expect(shows(tree, t('coach.proposal.accepted'))).toBe(false);
    expect(mocked.clear).toHaveBeenCalledWith('A', 'plan'); // A's old plan copy must not survive the acceptance
    expect(mocked.refresh).not.toHaveBeenCalledWith('A'); // but A's plan is never read while B is signed in
  });

  it('does not let a late plan refresh for A change what B sees', async () => {
    mocked.history.mockImplementation(async (user: string) => (user === 'A' ? [exchange('1', { proposal: pending('p1') })] : [exchange('2')]));
    mocked.decide.mockResolvedValue({ kind: 'accepted', changedDays: [5] });
    const refresh = deferred<unknown>();
    mocked.refresh.mockReturnValue(refresh.promise);
    const tree = await mount();
    await press(tree, 'coach-accept-p1');

    await switchTo(tree, 'B');
    await act(async () => refresh.resolve(bundle));

    expect(shows(tree, t('coach.proposal.refreshing'))).toBe(false);
    expect(shows(tree, t('coach.proposal.refreshed'))).toBe(false);
    expect(shows(tree, t('coach.proposal.accepted'))).toBe(false);
  });

  it('shows nothing and does not load anything when nobody is signed in', async () => {
    mockUserId = null;

    const tree = await mount();

    expect(mocked.history).not.toHaveBeenCalled();
    expect(mocked.send).not.toHaveBeenCalled();
    expect(shows(tree, 'question')).toBe(false);
  });
});

describe('switching A to B and back to A', () => {
  it('keeps what A typed after coming back when A\'s earlier reply finally arrives', async () => {
    const reply = deferred<unknown>();
    mocked.send.mockReturnValue(reply.promise);
    const tree = await mount();
    await typeIn(tree, 'first question');
    await press(tree, 'coach-send');
    await switchTo(tree, 'B');
    await switchTo(tree, 'A');
    await typeIn(tree, 'a new unsent draft');

    await act(async () => reply.resolve(answered(exchange('1', { message: 'first question', reply: 'first answer' }))));

    expect(shows(tree, 'first answer')).toBe(true); // A's own answer still belongs to A
    expect(idOf(tree, 'coach-input').props.value).toBe('a new unsent draft'); // and does not erase newer input
  });

  it('keeps what is typed while a send is running, for the same account', async () => {
    const reply = deferred<unknown>();
    mocked.send.mockReturnValue(reply.promise);
    const tree = await mount();
    await typeIn(tree, 'first question');
    await press(tree, 'coach-send');
    await typeIn(tree, 'typed while waiting');

    await act(async () => reply.resolve(answered(exchange('1', { message: 'first question', reply: 'first answer' }))));

    expect(idOf(tree, 'coach-input').props.value).toBe('typed while waiting');
  });

  it('still clears the box when the answered message is the one in the box', async () => {
    mocked.send.mockResolvedValue(answered(exchange('1', { message: 'first question', reply: 'first answer' })));
    const tree = await mount();
    await typeIn(tree, 'first question');

    await press(tree, 'coach-send');

    expect(idOf(tree, 'coach-input').props.value).toBe('');
  });

  it('shows A\'s answer from the server after coming back, and lets A send again', async () => {
    const reply = deferred<unknown>();
    mocked.send.mockReturnValueOnce(reply.promise).mockImplementation(async (requestId: string, message: string) => answered(exchange('2', { requestId, message, reply: 'second answer' })));
    mocked.history.mockResolvedValue([]);
    const tree = await mount();
    await typeIn(tree, 'first question');
    await press(tree, 'coach-send');
    await switchTo(tree, 'B');
    await act(async () => reply.resolve(answered(exchange('1', { message: 'first question', reply: 'first answer' })))); // arrives while B is shown
    expect(shows(tree, 'first answer')).toBe(false);

    mocked.history.mockResolvedValue([exchange('1', { message: 'first question', reply: 'first answer' })]);
    await switchTo(tree, 'A');
    expect(shows(tree, 'first answer')).toBe(true);
    await typeIn(tree, 'second question');
    await press(tree, 'coach-send');

    expect(mocked.send).toHaveBeenCalledTimes(2);
    expect(shows(tree, 'second answer')).toBe(true);
  });

  it('never lets A\'s earlier failure replace the state of a newer A request', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocked.send.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const tree = await mount();
    await typeIn(tree, 'first question');
    await press(tree, 'coach-send');
    await switchTo(tree, 'B');
    await switchTo(tree, 'A');

    await act(async () => first.resolve({ kind: 'offline' }));
    await typeIn(tree, 'second question');
    await press(tree, 'coach-send');
    await act(async () => second.resolve(answered(exchange('2', { message: 'second question', reply: 'second answer' }))));

    expect(shows(tree, 'second answer')).toBe(true);
    expect(maybe(tree, 'coach-check-again')).toBeUndefined(); // the old offline notice is gone, not resurrected
  });
});

describe('screen smoke test in every language', () => {
  afterEach(async () => {
    await i18next.changeLanguage('en');
  });

  it.each(['en', 'ms', 'ta'])('renders the history, an unknown-outcome notice and a proposal in %s without a missing translation', async (language) => {
    await i18next.changeLanguage(language);
    mocked.history.mockResolvedValue([exchange('1', { proposal: pending() })]);
    mocked.send.mockResolvedValue({ kind: 'unknown_outcome' });
    const tree = await mount();
    await typeIn(tree, 'a question');
    await press(tree, 'coach-send');

    const all = textsOf(tree);
    expect(all.some((s) => /\bcoach\.[a-z]+/i.test(s))).toBe(false); // no raw translation key on screen
    expect(shows(tree, t('coach.title'))).toBe(true);
    expect(shows(tree, t('coach.unknownOutcome'))).toBe(true);
    expect(shows(tree, t('coach.proposal.accept'))).toBe(true);
    expect(maybe(tree, 'coach-check-again')).toBeDefined();
    expect(maybe(tree, 'coach-ask-again')).toBeDefined();
    expect(mocked.send).toHaveBeenCalledTimes(1); // nothing was repeated by itself
  });
});
