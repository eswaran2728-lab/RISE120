// Rewarded ads for bonus food logs (and, later, AI messages). The ad SDK's "earned reward" callback is only
// a UI event: it grants nothing. Credit exists only when Google's server-side-verified callback reaches the
// server, which adds it to the ledger; this module then re-reads check-limit to see that.
import { supabase } from '../lib/supabase';
import type { LimitSnapshot } from './limits';

export type RewardType = 'food' | 'ai';

export interface RewardedHandle {
  load(): Promise<void>; // rejects if the ad cannot be loaded
  show(): Promise<{ earned: boolean }>; // resolves when the ad closes; earned = the local reward event fired
}

// The boundary around the ad SDK. `customData` is the server-issued one-use token, sent to AdMob as SSV custom_data.
export interface AdsSdk {
  available(): boolean;
  create(options: { customData: string }): RewardedHandle;
}

export type TokenResult = { status: 'ok'; token: string } | { status: 'premium' } | { status: 'cap_reached' } | { status: 'failed' };

export type WatchResult =
  | 'credited'
  | 'verifying' // the ad finished but the server has not (yet) credited it
  | 'dismissed'
  | 'load_failed'
  | 'failed'
  | 'premium'
  | 'cap_reached'
  | 'unavailable'
  | 'wrong_account';

export interface RewardedAdService {
  watch(userId: string, rewardType: RewardType): Promise<WatchResult>;
}

// Asks the server for a one-use token bound to this user and reward type.
export async function requestAdRewardToken(_userId: string, rewardType: RewardType): Promise<TokenResult> {
  try {
    const { data, error } = await supabase.functions.invoke('request-ad-reward', { method: 'POST', body: { rewardType } });
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      if (status === 409) return { status: 'premium' };
      if (status === 429) return { status: 'cap_reached' };
      return { status: 'failed' };
    }
    return typeof data?.token === 'string' && data.token !== '' ? { status: 'ok', token: data.token } : { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

interface Options {
  ads: AdsSdk;
  requestToken: (userId: string, rewardType: RewardType) => Promise<TokenResult>;
  loadLimits: (userId: string) => Promise<LimitSnapshot>;
  currentUserId: () => string | null;
  pollDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

// Google's callback usually reaches the server within seconds of the ad ending.
const DEFAULT_POLL_DELAYS_MS = [1000, 2000, 3000, 5000, 8000];

export function createRewardedAdService({
  ads,
  requestToken,
  loadLimits,
  currentUserId,
  pollDelaysMs = DEFAULT_POLL_DELAYS_MS,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}: Options): RewardedAdService {
  return {
    async watch(userId, rewardType) {
      if (!ads.available()) return 'unavailable';
      if (currentUserId() !== userId) return 'wrong_account';

      const token = await requestToken(userId, rewardType);
      if (token.status !== 'ok') return token.status;

      const baseline = await loadLimits(userId).catch(() => null);

      const rewarded = ads.create({ customData: token.token });
      try {
        await rewarded.load();
      } catch {
        return 'load_failed';
      }
      let earned: boolean;
      try {
        ({ earned } = await rewarded.show());
      } catch {
        return 'failed';
      }
      if (!earned) return 'dismissed';
      if (!baseline) return 'verifying';

      // The local callback proved nothing. Look for the verified credit on the server.
      for (const delay of pollDelaysMs) {
        await sleep(delay);
        if (currentUserId() !== userId) return 'verifying'; // do not read another account's limits
        const after = await loadLimits(userId).catch(() => null);
        if (after && after.tier !== 'premium' && after.adRewards.used > baseline.adRewards.used) return 'credited';
      }
      return 'verifying';
    },
  };
}
