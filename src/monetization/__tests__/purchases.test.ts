import { createPurchaseService, PurchasesSdk, StorePackage } from '../purchases';
import type { LimitSnapshot } from '../limits';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const snapshot = (tier: 'free' | 'premium'): LimitSnapshot => ({
  tier,
  quotaDayUtc: '2026-10-14',
  resetsAt: '2026-10-15T00:00:00.000Z',
  planDaysAccessible: tier === 'premium' ? 120 : 14,
  food: { used: 0, base: tier === 'premium' ? null : 3, bonus: 0, remaining: tier === 'premium' ? null : 3 },
  ai: { used: 0, base: tier === 'premium' ? null : 1, bonus: 0, remaining: tier === 'premium' ? null : 1 },
  adRewards: { used: 0, max: tier === 'premium' ? 0 : 3, remaining: tier === 'premium' ? 0 : 3 },
});

const pkg = (kind: StorePackage['kind'], priceString: string): StorePackage => ({ id: `$rc_${kind}`, kind, priceString, title: `Rise120 ${kind}`, native: { kind } });

function fakeSdk(over: Partial<PurchasesSdk> = {}): PurchasesSdk & { calls: string[] } {
  const calls: string[] = [];
  const sdk: PurchasesSdk = {
    isConfigured: () => true,
    logIn: jest.fn(async (id) => void calls.push(`logIn:${id}`)),
    logOut: jest.fn(async () => void calls.push('logOut')),
    getPackages: jest.fn(async () => [pkg('monthly', 'RM39.90'), pkg('yearly', 'RM199.00'), pkg('lifetime', 'RM399.00')]),
    purchase: jest.fn(async () => void calls.push('purchase')),
    restore: jest.fn(async () => ({ hasActiveEntitlement: true })),
    ...over,
  };
  return Object.assign(sdk, { calls });
}

const service = (sdk: PurchasesSdk, loadLimits: (userId: string) => Promise<LimitSnapshot>) =>
  createPurchaseService({ sdk, loadLimits, pollDelaysMs: [0, 0, 0], sleep: async () => undefined });

describe('purchase identity', () => {
  it('identifies the store customer by the Supabase user id, and switches without leaving A signed in', async () => {
    const sdk = fakeSdk();
    const purchases = service(sdk, async () => snapshot('free'));

    await purchases.syncIdentity(A);
    await purchases.syncIdentity(A); // the same account again does nothing
    await purchases.syncIdentity(B);

    expect(sdk.calls).toEqual([`logIn:${A}`, `logIn:${B}`]);
  });

  it('logs the customer out on sign-out, once, and tolerates the SDK refusing', async () => {
    const sdk = fakeSdk({ logOut: jest.fn(async () => { throw new Error('anonymous'); }) });
    const purchases = service(sdk, async () => snapshot('free'));
    await purchases.syncIdentity(A);

    await expect(purchases.syncIdentity(null)).resolves.toBeUndefined();
    await purchases.syncIdentity(null);

    expect(sdk.logOut).toHaveBeenCalledTimes(1);
  });

  it('does nothing when purchases are not configured in this build', async () => {
    const sdk = fakeSdk({ isConfigured: () => false });

    await service(sdk, async () => snapshot('free')).syncIdentity(A);

    expect(sdk.logIn).not.toHaveBeenCalled();
  });
});

describe('loadOffer', () => {
  const load = (sdk: PurchasesSdk) => service(sdk, async () => snapshot('free')).loadOffer();

  it('returns the store-fetched localized price for monthly, yearly and lifetime, in that order', async () => {
    const sdk = fakeSdk({ getPackages: jest.fn(async () => [pkg('lifetime', 'RM399.00'), pkg('monthly', 'RM39.90'), pkg('yearly', 'RM199.00')]) });

    const offer = await load(sdk);

    expect(offer.status).toBe('ready');
    expect(offer.status === 'ready' && offer.packages.map((p) => [p.kind, p.priceString])).toEqual([
      ['monthly', 'RM39.90'],
      ['yearly', 'RM199.00'],
      ['lifetime', 'RM399.00'],
    ]);
  });

  it('shows only what the store actually offers (a product that is not for sale is simply absent)', async () => {
    const sdk = fakeSdk({ getPackages: jest.fn(async () => [pkg('monthly', 'RM39.90')]) });

    const offer = await load(sdk);

    expect(offer.status === 'ready' && offer.packages.map((p) => p.kind)).toEqual(['monthly']);
  });

  it.each([
    ['no current offering', async () => null],
    ['an empty offering', async () => []],
    ['a store error', async () => { throw new Error('store unreachable'); }],
  ])('reports unavailable for %s', async (_name, getPackages) => {
    expect(await load(fakeSdk({ getPackages: jest.fn(getPackages as () => Promise<StorePackage[] | null>) }))).toEqual({ status: 'unavailable' });
  });

  it('reports not_configured when the build has no purchases key', async () => {
    expect(await load(fakeSdk({ isConfigured: () => false }))).toEqual({ status: 'not_configured' });
  });
});

describe('purchase', () => {
  it('reports a cancelled purchase and treats the customer as unchanged', async () => {
    const sdk = fakeSdk({ purchase: jest.fn(async () => { throw Object.assign(new Error('cancelled'), { cancelled: true }); }) });
    const loadLimits = jest.fn(async () => snapshot('free'));
    const purchases = service(sdk, loadLimits);
    await purchases.syncIdentity(A);

    expect(await purchases.purchase(A, pkg('monthly', 'RM39.90'))).toBe('cancelled');
    expect(loadLimits).not.toHaveBeenCalled();
  });

  it('reports a failed purchase', async () => {
    const sdk = fakeSdk({ purchase: jest.fn(async () => { throw new Error('billing unavailable'); }) });
    const purchases = service(sdk, async () => snapshot('free'));
    await purchases.syncIdentity(A);

    expect(await purchases.purchase(A, pkg('monthly', 'RM39.90'))).toBe('failed');
  });

  it('is premium only once the server says so, not when the store callback returns', async () => {
    const answers = [snapshot('free'), snapshot('premium')]; // the webhook is a moment late
    const loadLimits = jest.fn(async () => answers.shift() ?? snapshot('premium'));
    const sdk = fakeSdk();
    const purchases = service(sdk, loadLimits);
    await purchases.syncIdentity(A);

    expect(await purchases.purchase(A, pkg('yearly', 'RM199.00'))).toBe('premium');
    expect(loadLimits).toHaveBeenCalledTimes(2);
    expect(loadLimits).toHaveBeenCalledWith(A);
  });

  it('stays "processing" if the server has not confirmed after the wait, never claiming premium', async () => {
    const loadLimits = jest.fn(async () => snapshot('free'));
    const purchases = service(fakeSdk(), loadLimits);
    await purchases.syncIdentity(A);

    expect(await purchases.purchase(A, pkg('monthly', 'RM39.90'))).toBe('processing');
    expect(loadLimits).toHaveBeenCalledTimes(3);
  });

  it('keeps waiting through failed limit reads', async () => {
    const reads = [() => Promise.reject(new Error('offline')), () => Promise.resolve(snapshot('premium'))];
    const loadLimits = jest.fn(async () => (reads.shift() ?? (() => Promise.resolve(snapshot('premium'))))());
    const purchases = service(fakeSdk(), loadLimits);
    await purchases.syncIdentity(A);

    expect(await purchases.purchase(A, pkg('monthly', 'RM39.90'))).toBe('premium');
  });

  it('refuses to buy for an account that is not the signed-in customer', async () => {
    const sdk = fakeSdk();
    const purchases = service(sdk, async () => snapshot('free'));
    await purchases.syncIdentity(B);

    expect(await purchases.purchase(A, pkg('monthly', 'RM39.90'))).toBe('wrong_account');
    expect(sdk.purchase).not.toHaveBeenCalled();
  });

  it('does not read another account\'s limits when the user switches during the purchase', async () => {
    const sdk = fakeSdk();
    const loadLimits = jest.fn(async () => snapshot('premium'));
    const purchases = service(sdk, loadLimits);
    await purchases.syncIdentity(A);
    (sdk.purchase as jest.Mock).mockImplementation(async () => {
      await purchases.syncIdentity(B); // the account changes while the store sheet is open
    });

    expect(await purchases.purchase(A, pkg('monthly', 'RM39.90'))).toBe('wrong_account');
    expect(loadLimits).not.toHaveBeenCalled();
  });
});

describe('restore', () => {
  it('restores into the signed-in account and confirms with the server', async () => {
    const purchases = service(fakeSdk(), async () => snapshot('premium'));
    await purchases.syncIdentity(A);

    expect(await purchases.restore(A)).toBe('premium');
  });

  it('says processing when the store has an entitlement the server does not show yet', async () => {
    const purchases = service(fakeSdk(), async () => snapshot('free'));
    await purchases.syncIdentity(A);

    expect(await purchases.restore(A)).toBe('processing');
  });

  it('says nothing_found when there is nothing to restore', async () => {
    const sdk = fakeSdk({ restore: jest.fn(async () => ({ hasActiveEntitlement: false })) });
    const purchases = service(sdk, async () => snapshot('free'));
    await purchases.syncIdentity(A);

    expect(await purchases.restore(A)).toBe('nothing_found');
  });

  it('reports a failed restore, and refuses for the wrong account', async () => {
    const failing = service(fakeSdk({ restore: jest.fn(async () => { throw new Error('offline'); }) }), async () => snapshot('free'));
    await failing.syncIdentity(A);
    expect(await failing.restore(A)).toBe('failed');

    const other = service(fakeSdk(), async () => snapshot('free'));
    await other.syncIdentity(B);
    expect(await other.restore(A)).toBe('wrong_account');
  });
});

// An SDK whose logIn/logOut stay pending until the test releases them, tracking who the customer really is.
function slowSdk() {
  const state: { customer: string | null; releases: (() => void)[]; log: string[] } = { customer: null, releases: [], log: [] };
  const pending = (action: () => void, label: string) =>
    new Promise<void>((resolve) => {
      state.log.push(label);
      state.releases.push(() => {
        action();
        resolve();
      });
    });
  const sdk = fakeSdk({
    logIn: jest.fn((id: string) => pending(() => (state.customer = id), `logIn:${id}`)),
    logOut: jest.fn(() => pending(() => (state.customer = null), 'logOut')),
  });
  // Lets the oldest pending call finish and gives the service a few ticks to start the next one.
  const release = async () => {
    state.releases.shift()?.();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { sdk, state, release };
}

describe('identity changes while a login is in flight', () => {
  const pkgM = pkg('monthly', 'RM39.90');

  it('ends with the SDK logged in as B after a rapid switch from A, one change at a time', async () => {
    const { sdk, state, release } = slowSdk();
    const purchases = service(sdk, async () => snapshot('premium'));

    const first = purchases.syncIdentity(A);
    const second = purchases.syncIdentity(B);
    expect(state.log).toEqual([`logIn:${A}`]); // B waits for A to finish; the two never overlap
    await release();
    expect(state.log).toEqual([`logIn:${A}`, `logIn:${B}`]);
    await release();
    await Promise.all([first, second]);

    expect(state.customer).toBe(B);
  });

  it('blocks purchases and restores until B is confirmed, and never for A', async () => {
    const { sdk, state, release } = slowSdk();
    const purchases = service(sdk, async () => snapshot('premium'));
    const first = purchases.syncIdentity(A);
    const second = purchases.syncIdentity(B);

    expect(await purchases.purchase(B, pkgM)).toBe('wrong_account');
    expect(await purchases.restore(B)).toBe('wrong_account');
    await release(); // A is now logged in, B is not yet
    expect(await purchases.purchase(A, pkgM)).toBe('wrong_account');
    expect(await purchases.purchase(B, pkgM)).toBe('wrong_account');
    expect(sdk.purchase).not.toHaveBeenCalled();

    await release();
    await Promise.all([first, second]);
    expect(state.customer).toBe(B);
    expect(await purchases.purchase(A, pkgM)).toBe('wrong_account');
    expect(await purchases.purchase(B, pkgM)).toBe('premium');
    expect(await purchases.restore(B)).toBe('premium');
  });

  it('finishes logged out when the user signs out during an in-flight login', async () => {
    const { sdk, state, release } = slowSdk();
    const purchases = service(sdk, async () => snapshot('premium'));

    const login = purchases.syncIdentity(A);
    const logout = purchases.syncIdentity(null);
    await release(); // the login completes after the sign-out was requested
    expect(state.log).toEqual([`logIn:${A}`, 'logOut']);
    await release();
    await Promise.all([login, logout]);

    expect(state.customer).toBeNull();
    expect(await purchases.purchase(A, pkgM)).toBe('wrong_account');
  });

  it('does not log in and out again when the user comes straight back to A', async () => {
    const { sdk, state, release } = slowSdk();
    const purchases = service(sdk, async () => snapshot('premium'));

    const all = [purchases.syncIdentity(A), purchases.syncIdentity(B), purchases.syncIdentity(A)];
    await release();
    await Promise.all(all);

    expect(state.log).toEqual([`logIn:${A}`]);
    expect(state.customer).toBe(A);
    expect(await purchases.purchase(A, pkgM)).toBe('premium');
  });

  it('keeps purchases blocked if the login for B fails, and recovers on the next sync', async () => {
    const calls: string[] = [];
    let failNext = true;
    const sdk = fakeSdk({
      logIn: jest.fn(async (id: string) => {
        calls.push(id);
        if (id === B && failNext) {
          failNext = false;
          throw new Error('offline');
        }
      }),
    });
    const purchases = service(sdk, async () => snapshot('premium'));
    await purchases.syncIdentity(A);

    await purchases.syncIdentity(B);
    expect(await purchases.purchase(B, pkgM)).toBe('wrong_account');
    expect(await purchases.purchase(A, pkgM)).toBe('wrong_account');

    await purchases.syncIdentity(B);
    expect(calls).toEqual([A, B, B]);
    expect(await purchases.purchase(B, pkgM)).toBe('premium');
  });
});
