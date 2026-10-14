import { createRevenueCatSdk } from '../purchasesSdk';
import { createAdMobSdk } from '../adsSdk';

// The thin wrappers around the two native SDKs, tested against mocks of those SDKs. Real store and AdMob
// behaviour can only be checked in a development build with real accounts.
const mockPurchases = {
  configure: jest.fn(),
  isConfigured: jest.fn(async () => true),
  logIn: jest.fn(async () => ({ customerInfo: {}, created: false })),
  logOut: jest.fn(async () => ({})),
  getOfferings: jest.fn(),
  purchasePackage: jest.fn(),
  restorePurchases: jest.fn(),
};

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: mockPurchases,
  PACKAGE_TYPE: { MONTHLY: 'MONTHLY', ANNUAL: 'ANNUAL', LIFETIME: 'LIFETIME', WEEKLY: 'WEEKLY', CUSTOM: 'CUSTOM' },
  PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1' },
}));

type Listener = (payload?: unknown) => void;
const mockListeners = new Map<string, Listener>();
const mockRewarded = {
  addAdEventListener: jest.fn((type: string, fn: Listener) => {
    mockListeners.set(type, fn);
    return () => mockListeners.delete(type);
  }),
  load: jest.fn(),
  show: jest.fn(async () => undefined),
};
const mockCreateForAdRequest = jest.fn(() => mockRewarded);

jest.mock('react-native-google-mobile-ads', () => ({
  __esModule: true,
  default: () => ({ initialize: jest.fn(async () => []) }),
  RewardedAd: { createForAdRequest: (...args: unknown[]) => (mockCreateForAdRequest as (...a: unknown[]) => unknown)(...args) },
  RewardedAdEventType: { LOADED: 'rewarded_loaded', EARNED_REWARD: 'rewarded_earned_reward' },
  AdEventType: { ERROR: 'error', CLOSED: 'closed' },
  TestIds: { REWARDED: 'ca-app-pub-3940256099942544/5224354917' },
}));


const offering = (packages: unknown[]) => ({ current: { availablePackages: packages } });
const rcPackage = (packageType: string, priceString: string) => ({
  identifier: `$rc_${packageType}`,
  packageType,
  product: { priceString, title: `Rise120 (${packageType})` },
});

describe('RevenueCat adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPurchases.isConfigured.mockResolvedValue(true);
  });

  it('configures once with the public SDK key and logs in by Supabase id', async () => {
    const sdk = createRevenueCatSdk('goog_public_key');
    expect(mockPurchases.configure).toHaveBeenCalledWith({ apiKey: 'goog_public_key' });

    await sdk.logIn('uuid-1');
    await sdk.logOut();

    expect(mockPurchases.logIn).toHaveBeenCalledWith('uuid-1');
    expect(mockPurchases.logOut).toHaveBeenCalled();
  });

  it('is not configured without a key, and never calls the SDK', async () => {
    const sdk = createRevenueCatSdk(null);

    expect(sdk.isConfigured()).toBe(false);
    expect(mockPurchases.configure).not.toHaveBeenCalled();
  });

  it('maps store packages to monthly/yearly/lifetime with the store-fetched price, dropping other types', async () => {
    mockPurchases.getOfferings.mockResolvedValue(offering([rcPackage('WEEKLY', 'RM9.90'), rcPackage('MONTHLY', 'RM39.90'), rcPackage('ANNUAL', 'RM199.00'), rcPackage('LIFETIME', 'RM399.00'), rcPackage('CUSTOM', 'RM1')]));

    const packages = await createRevenueCatSdk('k').getPackages();

    expect(packages?.map((p) => [p.kind, p.priceString])).toEqual([['monthly', 'RM39.90'], ['yearly', 'RM199.00'], ['lifetime', 'RM399.00']]);
  });

  it('returns null when there is no current offering', async () => {
    mockPurchases.getOfferings.mockResolvedValue({ current: null });

    expect(await createRevenueCatSdk('k').getPackages()).toBeNull();
  });

  it('purchases the native package and flags a cancellation by error code or the userCancelled flag', async () => {
    mockPurchases.getOfferings.mockResolvedValue(offering([rcPackage('MONTHLY', 'RM39.90')]));
    const sdk = createRevenueCatSdk('k');
    const [monthly] = (await sdk.getPackages())!;

    mockPurchases.purchasePackage.mockResolvedValueOnce({ customerInfo: {} });
    await expect(sdk.purchase(monthly)).resolves.toBeUndefined();
    expect(mockPurchases.purchasePackage).toHaveBeenCalledWith(expect.objectContaining({ identifier: '$rc_MONTHLY' }));

    mockPurchases.purchasePackage.mockRejectedValueOnce({ code: '1', userCancelled: true, message: 'cancelled' });
    await expect(sdk.purchase(monthly)).rejects.toMatchObject({ cancelled: true });

    mockPurchases.purchasePackage.mockRejectedValueOnce({ code: '5', userCancelled: false, message: 'billing' });
    await expect(sdk.purchase(monthly)).rejects.not.toMatchObject({ cancelled: true });
  });

  it('reports whether a restore found an active entitlement', async () => {
    mockPurchases.restorePurchases.mockResolvedValueOnce({ entitlements: { active: { premium: {} } } });
    expect(await createRevenueCatSdk('k').restore()).toEqual({ hasActiveEntitlement: true });

    mockPurchases.restorePurchases.mockResolvedValueOnce({ entitlements: { active: {} } });
    expect(await createRevenueCatSdk('k').restore()).toEqual({ hasActiveEntitlement: false });
  });
});

describe('AdMob adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.clear();
  });

  it('is available only with an ad unit', () => {
    expect(createAdMobSdk('ca-app-pub-1/2').available()).toBe(true);
    expect(createAdMobSdk(null).available()).toBe(false);
  });

  it('creates the rewarded ad with the token as SSV custom data and no user id', () => {
    createAdMobSdk('ca-app-pub-1/2').create({ customData: 'tok' });

    expect(mockCreateForAdRequest).toHaveBeenCalledWith('ca-app-pub-1/2', { serverSideVerificationOptions: { customData: 'tok' } });
  });

  it('loads on LOADED and rejects on ERROR', async () => {
    const ok = createAdMobSdk('u').create({ customData: 't' });
    const loading = ok.load();
    mockListeners.get('rewarded_loaded')!();
    await expect(loading).resolves.toBeUndefined();

    const bad = createAdMobSdk('u').create({ customData: 't' });
    const failing = bad.load();
    mockListeners.get('error')!(new Error('no fill'));
    await expect(failing).rejects.toThrow();
  });

  it('resolves show with earned=true only if the reward event fired before the ad closed', async () => {
    const earned = createAdMobSdk('u').create({ customData: 't' });
    const shown = earned.show();
    mockListeners.get('rewarded_earned_reward')!({ amount: 1, type: 'reward' });
    mockListeners.get('closed')!();
    await expect(shown).resolves.toEqual({ earned: true });

    const dismissed = createAdMobSdk('u').create({ customData: 't' });
    const closedEarly = dismissed.show();
    mockListeners.get('closed')!();
    await expect(closedEarly).resolves.toEqual({ earned: false });
  });
});
