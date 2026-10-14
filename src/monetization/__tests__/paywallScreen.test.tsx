import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import PaywallScreen from '../../../app/paywall';
import { t } from '../../i18n';
import { loadLimitsOrCached, LimitSnapshot } from '../limits';
import { getPurchaseService } from '../services';

let mockUserId = 'A';
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: { user: { id: mockUserId } } }) }));
jest.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('../../cache/userCache', () => ({ readCache: jest.fn(), writeCache: jest.fn() }));
jest.mock('../services', () => ({ getPurchaseService: jest.fn() }));
jest.mock('../limits', () => ({ ...jest.requireActual('../limits'), loadLimitsOrCached: jest.fn() }));

type Answer = { snapshot: LimitSnapshot; stale: boolean } | null;

const snapshot = (tier: 'free' | 'premium'): LimitSnapshot => ({
  tier,
  quotaDayUtc: '2026-10-14',
  resetsAt: '2026-10-15T00:00:00.000Z',
  planDaysAccessible: tier === 'premium' ? 120 : 14,
  food: { used: 0, base: tier === 'premium' ? null : 3, bonus: 0, remaining: tier === 'premium' ? null : 3 },
  ai: { used: 0, base: tier === 'premium' ? null : 1, bonus: 0, remaining: tier === 'premium' ? null : 1 },
  adRewards: { used: 0, max: 3, remaining: 3 },
});
const fresh = (tier: 'free' | 'premium'): Answer => ({ snapshot: snapshot(tier), stale: false });
const remembered = (tier: 'free' | 'premium'): Answer => ({ snapshot: snapshot(tier), stale: true });

const offerWith = (price: string) => ({
  status: 'ready' as const,
  packages: [{ id: `m-${price}`, kind: 'monthly' as const, priceString: price, title: `Rise120 ${price}`, native: {} }],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

// Per-account answers, consumed in call order, so each test scripts exactly what each account's requests return.
const limitAnswers: Record<string, (() => Promise<Answer>)[]> = {};
const offers: (() => Promise<unknown>)[] = [];
const service = { loadOffer: jest.fn(), purchase: jest.fn(), restore: jest.fn() };

const answerLimits = (userId: string, ...answers: (Answer | Promise<Answer>)[]) => {
  limitAnswers[userId] = answers.map((a) => () => Promise.resolve(a));
};

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<PaywallScreen />);
  });
  return tree;
}

const switchTo = async (tree: ReactTestRenderer, userId: string) => {
  mockUserId = userId;
  await act(async () => {
    tree.update(<PaywallScreen />);
  });
};

const texts = (tree: ReactTestRenderer): string[] => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') out.push(node);
    else if (node && typeof node === 'object') ((node as { children?: unknown[] | null }).children ?? []).forEach(walk);
  };
  walk(tree.toJSON());
  return out;
};

const press = async (tree: ReactTestRenderer, label: string) => {
  const target = tree.root.findAll((n) => typeof n.props.onPress === 'function' && n.findAll((m) => m.children.includes(label)).length > 0)[0];
  await act(async () => {
    await target.props.onPress();
  });
};

describe('PaywallScreen access and offering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = 'A';
    for (const key of Object.keys(limitAnswers)) delete limitAnswers[key];
    offers.length = 0;
    (loadLimitsOrCached as jest.Mock).mockImplementation((uid: string) => (limitAnswers[uid]?.shift() ?? (() => Promise.resolve(null)))());
    service.loadOffer.mockImplementation(() => (offers.shift() ?? (() => Promise.resolve(offerWith('RM39.90'))))());
    (getPurchaseService as jest.Mock).mockReturnValue(service);
  });

  it('shows "cannot verify" and Retry, not products, for a remembered premium snapshot', async () => {
    answerLimits('A', remembered('premium'));

    const shown = texts(await render());

    expect(shown).not.toContain(t('paywall.premiumActive'));
    expect(shown).toContain(t('paywall.cannotVerify'));
    expect(shown).toContain(t('errors.retry'));
    expect(shown).not.toContain('RM39.90');
  });

  it('shows "cannot verify" and Retry, not products, for a remembered FREE snapshot', async () => {
    answerLimits('A', remembered('free'));

    const shown = texts(await render());

    expect(shown).toContain(t('paywall.cannotVerify'));
    expect(shown).toContain(t('errors.retry'));
    expect(shown).not.toContain('RM39.90');
  });

  it('shows "cannot verify" and Retry, not products, when there is no current server answer at all', async () => {
    answerLimits('A', null);

    const shown = texts(await render());

    expect(shown).toContain(t('paywall.cannotVerify'));
    expect(shown).toContain(t('errors.retry'));
    expect(shown).not.toContain('RM39.90');
  });

  it('offers the store products only when a fresh server answer confirms free', async () => {
    answerLimits('A', fresh('free'));

    const shown = texts(await render());

    expect(shown).toContain('RM39.90');
    expect(shown).not.toContain(t('paywall.cannotVerify'));
    expect(shown).not.toContain(t('paywall.premiumActive'));
  });

  it('confirms premium only from a fresh server answer', async () => {
    answerLimits('A', fresh('premium'));

    const shown = texts(await render());

    expect(shown).toContain(t('paywall.premiumActive'));
    expect(shown).not.toContain(t('paywall.cannotVerify'));
  });

  it('Retry asks the server again and offers products once it confirms free', async () => {
    answerLimits('A', null, fresh('free'));
    const tree = await render();
    expect(texts(tree)).not.toContain('RM39.90');

    await press(tree, t('errors.retry'));

    expect(texts(tree)).toContain('RM39.90');
    expect(texts(tree)).not.toContain(t('paywall.cannotVerify'));
  });
});

describe('PaywallScreen account switch races', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = 'A';
    for (const key of Object.keys(limitAnswers)) delete limitAnswers[key];
    offers.length = 0;
    (loadLimitsOrCached as jest.Mock).mockImplementation((uid: string) => (limitAnswers[uid]?.shift() ?? (() => Promise.resolve(null)))());
    service.loadOffer.mockImplementation(() => (offers.shift() ?? (() => Promise.resolve(offerWith('RM39.90'))))());
    (getPurchaseService as jest.Mock).mockReturnValue(service);
  });

  it("ignores account A's late answer after switching to B while A's request was loading", async () => {
    const aLimits = deferred<Answer>();
    const aOffer = deferred<unknown>();
    limitAnswers.A = [() => aLimits.promise];
    limitAnswers.B = [() => Promise.resolve(fresh('free'))];
    offers.push(() => aOffer.promise, () => Promise.resolve(offerWith('RM-B')));
    const tree = await render(); // A is still loading

    await switchTo(tree, 'B');
    expect(texts(tree)).toContain('RM-B');

    await act(async () => {
      aLimits.resolve(fresh('premium'));
      aOffer.resolve(offerWith('RM-A'));
    });

    const shown = texts(tree);
    expect(shown).toContain('RM-B');
    expect(shown).not.toContain('RM-A');
    expect(shown).not.toContain(t('paywall.premiumActive'));
  });

  it('shows nothing from A, only the loading state, while B is still loading', async () => {
    limitAnswers.A = [() => Promise.resolve(fresh('free'))];
    const bLimits = deferred<Answer>();
    limitAnswers.B = [() => bLimits.promise];
    offers.push(() => Promise.resolve(offerWith('RM-A')), () => new Promise(() => undefined));
    const tree = await render();
    expect(texts(tree)).toContain('RM-A');

    await switchTo(tree, 'B');

    expect(texts(tree)).not.toContain('RM-A');
    expect(texts(tree)).not.toContain(t('paywall.premiumActive'));
  });

  it("does not let A's post-purchase refresh change what B sees", async () => {
    const aRefresh = deferred<Answer>();
    limitAnswers.A = [() => Promise.resolve(fresh('free')), () => aRefresh.promise];
    limitAnswers.B = [() => Promise.resolve(fresh('free'))];
    offers.push(() => Promise.resolve(offerWith('RM-A')), () => Promise.resolve(offerWith('RM-B')));
    service.purchase.mockResolvedValue('processing');
    const tree = await render();

    await press(tree, 'RM-A'); // A buys; the refresh afterwards is still in flight
    await switchTo(tree, 'B');
    expect(texts(tree)).toContain('RM-B');

    await act(async () => {
      aRefresh.resolve(fresh('premium'));
    });

    const shown = texts(tree);
    expect(shown).toContain('RM-B');
    expect(shown).not.toContain(t('paywall.premiumActive'));
    expect(shown).not.toContain(t('paywall.processing'));
  });

  it("does not show A's purchase result message to B", async () => {
    const purchase = deferred<string>();
    limitAnswers.A = [() => Promise.resolve(fresh('free'))];
    limitAnswers.B = [() => Promise.resolve(fresh('free'))];
    offers.push(() => Promise.resolve(offerWith('RM-A')), () => Promise.resolve(offerWith('RM-B')));
    service.purchase.mockReturnValue(purchase.promise);
    const tree = await render();
    await press(tree, 'RM-A').catch(() => undefined);
    await switchTo(tree, 'B');

    await act(async () => {
      purchase.resolve('premium');
    });

    const shown = texts(tree);
    expect(shown).not.toContain(t('paywall.premiumActive'));
    expect(shown).toContain('RM-B');
  });

  it('still confirms premium for the same account after its own purchase', async () => {
    limitAnswers.A = [() => Promise.resolve(fresh('free'))];
    service.purchase.mockResolvedValue('premium');
    const tree = await render();

    await press(tree, 'RM39.90');

    expect(texts(tree)).toContain(t('paywall.premiumActive'));
  });
});
