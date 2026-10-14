// The app's single purchase and rewarded-ad services, wired to the real SDKs and the server. Public build
// settings come from EAS environment variables (never committed):
//   EXPO_PUBLIC_REVENUECAT_ANDROID_KEY            RevenueCat public SDK key for Google Play
//   EXPO_PUBLIC_ADMOB_REWARDED_ANDROID_UNIT_ID    AdMob rewarded ad unit (development builds fall back to Google's test unit)
import { createAdMobSdk } from './adsSdk';
import { loadLimits } from './limits';
import { createPurchaseService, PurchaseService } from './purchases';
import { createRevenueCatSdk } from './purchasesSdk';
import { createRewardedAdService, requestAdRewardToken, RewardedAdService } from './rewardedAds';

// The signed-in account, kept by the root layout. Every purchase and ad action checks against it.
let activeUserId: string | null = null;
export const setActiveUser = (userId: string | null) => {
  activeUserId = userId;
};

function rewardedUnitId(): string | null {
  const fromEnv = process.env.EXPO_PUBLIC_ADMOB_REWARDED_ANDROID_UNIT_ID;
  if (fromEnv) return fromEnv;
  if (!__DEV__) return null; // a release build never falls back to test ads
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-google-mobile-ads').TestIds.REWARDED as string;
  } catch {
    return null;
  }
}

let purchases: PurchaseService | null = null;
export function getPurchaseService(): PurchaseService {
  purchases ??= createPurchaseService({ sdk: createRevenueCatSdk(process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || null), loadLimits });
  return purchases;
}

let rewarded: RewardedAdService | null = null;
export function getRewardedAdService(): RewardedAdService {
  rewarded ??= createRewardedAdService({
    ads: createAdMobSdk(rewardedUnitId()),
    requestToken: requestAdRewardToken,
    loadLimits,
    currentUserId: () => activeUserId,
  });
  return rewarded;
}
