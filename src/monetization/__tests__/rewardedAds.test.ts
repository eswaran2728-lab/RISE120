import { supabase } from '../../lib/supabase';
import { createRewardedAdService, requestAdRewardToken, AdsSdk, RewardedHandle } from '../rewardedAds';
import type { LimitSnapshot } from '../limits';

jest.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() }, from: jest.fn(), rpc: jest.fn() } }));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const snapshot = (over: Partial<LimitSnapshot> = {}, bonus = 0, adsUsed = 0): LimitSnapshot => ({
  tier: 'free',
  quotaDayUtc: '2026-10-14',
  resetsAt: '2026-10-15T00:00:00.000Z',
  planDaysAccessible: 14,
  food: { used: 3, base: 3, bonus, remaining: bonus },
  ai: { used: 0, base: 1, bonus: 0, remaining: 1 },
  adRewards: { used: adsUsed, max: 3, remaining: 3 - adsUsed },
  ...over,
});

function setup(options: {
  load?: () => Promise<void>;
  show?: () => Promise<{ earned: boolean }>;
  available?: boolean;
  token?: Awaited<ReturnType<typeof requestAdRewardToken>>;
  limits?: LimitSnapshot[];
  current?: () => string | null;
} = {}) {
  const handle: RewardedHandle = {
    load: jest.fn(options.load ?? (async () => undefined)),
    show: jest.fn(options.show ?? (async () => ({ earned: true }))),
  };
  const ads: AdsSdk = { available: () => options.available ?? true, create: jest.fn(() => handle) };
  const requestToken = jest.fn(async () => options.token ?? ({ status: 'ok', token: 'server-token-1' } as const));
  const answers = [...(options.limits ?? [snapshot()])];
  const loadLimits = jest.fn(async () => (answers.length > 1 ? answers.shift()! : answers[0]));
  const service = createRewardedAdService({
    ads,
    requestToken,
    loadLimits,
    currentUserId: options.current ?? (() => A),
    pollDelaysMs: [0, 0, 0],
    sleep: async () => undefined,
  });
  return { service, ads, handle, requestToken, loadLimits };
}

describe('watching a rewarded ad', () => {
  it('passes the server-issued one-use token to the ad as SSV custom data', async () => {
    const { service, ads } = setup();

    await service.watch(A, 'food');

    expect(ads.create).toHaveBeenCalledTimes(1);
    expect(ads.create).toHaveBeenCalledWith({ customData: 'server-token-1' });
  });

  it('asks the server for the token for the reward type being earned', async () => {
    const { service, requestToken } = setup();

    await service.watch(A, 'ai');

    expect(requestToken).toHaveBeenCalledWith(A, 'ai');
  });

  it('reports a load failure and never shows an ad', async () => {
    const { service, handle } = setup({ load: async () => { throw new Error('no fill'); } });

    expect(await service.watch(A, 'food')).toBe('load_failed');
    expect(handle.show).not.toHaveBeenCalled();
  });

  it('grants nothing from the local earned-reward callback: without a server credit it is only "verifying"', async () => {
    const { service, loadLimits } = setup({ show: async () => ({ earned: true }), limits: [snapshot()] });

    expect(await service.watch(A, 'food')).toBe('verifying');
    expect(loadLimits.mock.calls.length).toBeGreaterThan(1); // it looked, and the server had not credited anything
  });

  it('never talks to the database tables or functions that grant credit', async () => {
    const { service } = setup({ limits: [snapshot()] });

    await service.watch(A, 'food');

    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('refreshes from the server and reports credited only once the verified credit shows up', async () => {
    const { service } = setup({ limits: [snapshot({}, 0, 0), snapshot({}, 0, 0), snapshot({}, 2, 1)] });

    expect(await service.watch(A, 'food')).toBe('credited');
  });

  it('also recognises a verified AI credit', async () => {
    const after = snapshot({ ai: { used: 1, base: 1, bonus: 1, remaining: 1 } }, 0, 1);
    const { service } = setup({ limits: [snapshot(), after] });

    expect(await service.watch(A, 'ai')).toBe('credited');
  });

  it('reports dismissed, without polling, when the ad was closed before the reward was earned', async () => {
    const { service, loadLimits } = setup({ show: async () => ({ earned: false }) });

    expect(await service.watch(A, 'food')).toBe('dismissed');
    expect(loadLimits).toHaveBeenCalledTimes(1); // only the baseline
  });

  it('reports failed when the ad cannot be shown', async () => {
    const { service } = setup({ show: async () => { throw new Error('already showing'); } });

    expect(await service.watch(A, 'food')).toBe('failed');
  });

  it('shows no ad choice to premium users and spends no token', async () => {
    const { service, ads } = setup({ token: { status: 'premium' } });

    expect(await service.watch(A, 'food')).toBe('premium');
    expect(ads.create).not.toHaveBeenCalled();
  });

  it('reports the daily cap and a failed token request without showing an ad', async () => {
    const capped = setup({ token: { status: 'cap_reached' } });
    expect(await capped.service.watch(A, 'food')).toBe('cap_reached');
    expect(capped.ads.create).not.toHaveBeenCalled();

    const failed = setup({ token: { status: 'failed' } });
    expect(await failed.service.watch(A, 'food')).toBe('failed');
  });

  it('is unavailable, and requests no token, when the build has no ad unit', async () => {
    const { service, requestToken } = setup({ available: false });

    expect(await service.watch(A, 'food')).toBe('unavailable');
    expect(requestToken).not.toHaveBeenCalled();
  });

  it('refuses when the signed-in account is not the one asking', async () => {
    const { service, requestToken } = setup({ current: () => B });

    expect(await service.watch(A, 'food')).toBe('wrong_account');
    expect(requestToken).not.toHaveBeenCalled();
  });

  it('does not read another account\'s limits if the user switched while the ad was showing', async () => {
    let current: string | null = A;
    const { service, loadLimits } = setup({
      current: () => current,
      show: async () => {
        current = B;
        return { earned: true };
      },
    });

    expect(await service.watch(A, 'food')).toBe('verifying');
    expect(loadLimits).toHaveBeenCalledTimes(1); // the baseline only
  });
});

describe('requestAdRewardToken', () => {
  beforeEach(() => jest.clearAllMocks());
  const invoke = supabase.functions.invoke as jest.Mock;

  it('calls request-ad-reward and returns the token', async () => {
    invoke.mockResolvedValue({ data: { token: 'abc', expiresAt: '2026-10-14T12:15:00Z' }, error: null });

    expect(await requestAdRewardToken(A, 'food')).toEqual({ status: 'ok', token: 'abc' });
    expect(invoke).toHaveBeenCalledWith('request-ad-reward', { method: 'POST', body: { rewardType: 'food' } });
  });

  it('maps the server refusals', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { context: { status: 409 } } });
    expect(await requestAdRewardToken(A, 'food')).toEqual({ status: 'premium' });

    invoke.mockResolvedValueOnce({ data: null, error: { context: { status: 429 } } });
    expect(await requestAdRewardToken(A, 'food')).toEqual({ status: 'cap_reached' });

    invoke.mockResolvedValueOnce({ data: null, error: { context: { status: 500 } } });
    expect(await requestAdRewardToken(A, 'food')).toEqual({ status: 'failed' });

    invoke.mockRejectedValueOnce(new Error('offline'));
    expect(await requestAdRewardToken(A, 'food')).toEqual({ status: 'failed' });

    invoke.mockResolvedValueOnce({ data: { nope: true }, error: null });
    expect(await requestAdRewardToken(A, 'food')).toEqual({ status: 'failed' });
  });
});
