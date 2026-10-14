import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import PaywallScreen from '../../../app/paywall';
import { t } from '../../i18n';
import { loadLimitsOrCached, LimitSnapshot } from '../limits';
import { getPurchaseService } from '../services';

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: { user: { id: 'A' } } }) }));
jest.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('../../cache/userCache', () => ({ readCache: jest.fn(), writeCache: jest.fn() }));
jest.mock('../services', () => ({ getPurchaseService: jest.fn() }));
jest.mock('../limits', () => ({ ...jest.requireActual('../limits'), loadLimitsOrCached: jest.fn() }));

const snapshot = (tier: 'free' | 'premium'): LimitSnapshot => ({
  tier,
  quotaDayUtc: '2026-10-14',
  resetsAt: '2026-10-15T00:00:00.000Z',
  planDaysAccessible: tier === 'premium' ? 120 : 14,
  food: { used: 0, base: tier === 'premium' ? null : 3, bonus: 0, remaining: tier === 'premium' ? null : 3 },
  ai: { used: 0, base: tier === 'premium' ? null : 1, bonus: 0, remaining: tier === 'premium' ? null : 1 },
  adRewards: { used: 0, max: 3, remaining: 3 },
});

const offer = {
  status: 'ready' as const,
  packages: [{ id: 'm', kind: 'monthly' as const, priceString: 'RM39.90', title: 'Rise120 monthly', native: {} }],
};

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<PaywallScreen />);
  });
  return tree;
}

const texts = (tree: ReactTestRenderer): string[] => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') out.push(node);
    else if (node && typeof node === 'object') {
      const n = node as { children?: unknown[] | null };
      (n.children ?? []).forEach(walk);
    }
  };
  walk(tree.toJSON());
  return out;
};

describe('PaywallScreen premium status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getPurchaseService as jest.Mock).mockReturnValue({ loadOffer: jest.fn(async () => offer), purchase: jest.fn(), restore: jest.fn() });
  });

  it('does not show "Premium active" for a cached premium snapshot that could not be refreshed', async () => {
    (loadLimitsOrCached as jest.Mock).mockResolvedValue({ snapshot: snapshot('premium'), stale: true });

    const shown = texts(await render());

    expect(shown).not.toContain(t('paywall.premiumActive'));
    expect(shown).toContain(t('paywall.cannotVerify'));
  });

  it('does not offer a purchase while access cannot be verified (a second purchase could be a double charge)', async () => {
    (loadLimitsOrCached as jest.Mock).mockResolvedValue({ snapshot: snapshot('premium'), stale: true });

    const shown = texts(await render());

    expect(shown).not.toContain('RM39.90');
  });

  it('confirms premium when a fresh check-limit response says premium', async () => {
    (loadLimitsOrCached as jest.Mock).mockResolvedValue({ snapshot: snapshot('premium'), stale: false });

    const shown = texts(await render());

    expect(shown).toContain(t('paywall.premiumActive'));
    expect(shown).not.toContain(t('paywall.cannotVerify'));
  });

  it('offers the store prices to a free user', async () => {
    (loadLimitsOrCached as jest.Mock).mockResolvedValue({ snapshot: snapshot('free'), stale: false });

    const shown = texts(await render());

    expect(shown).toContain('RM39.90');
    expect(shown).not.toContain(t('paywall.premiumActive'));
    expect(shown).not.toContain(t('paywall.cannotVerify'));
  });

  it('still offers the store prices when the limits are unknown and nothing is remembered', async () => {
    (loadLimitsOrCached as jest.Mock).mockResolvedValue(null);

    const shown = texts(await render());

    expect(shown).toContain('RM39.90');
    expect(shown).not.toContain(t('paywall.premiumActive'));
  });
});
