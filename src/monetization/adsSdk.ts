// AdMob (react-native-google-mobile-ads) behind the AdsSdk boundary. The server-issued token is attached
// as server-side-verification custom data; no user id is sent to Google.
import type { AdsSdk, RewardedHandle } from './rewardedAds';

export function createAdMobSdk(adUnitId: string | null): AdsSdk {
  return {
    available: () => !!adUnitId,
    create({ customData }): RewardedHandle {
      // Loaded lazily: the native module does not exist in Jest or in a build made before it was added.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ads = require('react-native-google-mobile-ads');
      const rewarded = ads.RewardedAd.createForAdRequest(adUnitId, { serverSideVerificationOptions: { customData } });
      const initialized: Promise<unknown> = ads.default().initialize();

      return {
        load: () =>
          new Promise<void>((resolve, reject) => {
            const stop: (() => void)[] = [];
            const finish = (done: () => void) => {
              stop.forEach((unsubscribe) => unsubscribe());
              done();
            };
            stop.push(rewarded.addAdEventListener(ads.RewardedAdEventType.LOADED, () => finish(resolve)));
            stop.push(rewarded.addAdEventListener(ads.AdEventType.ERROR, () => finish(() => reject(new Error('Ad failed to load')))));
            void initialized.then(() => rewarded.load(), () => finish(() => reject(new Error('Ads not initialized'))));
          }),

        show: () =>
          new Promise<{ earned: boolean }>((resolve, reject) => {
            const stop: (() => void)[] = [];
            let earned = false;
            const finish = (done: () => void) => {
              stop.forEach((unsubscribe) => unsubscribe());
              done();
            };
            // A UI signal only. It is never treated as a grant.
            stop.push(rewarded.addAdEventListener(ads.RewardedAdEventType.EARNED_REWARD, () => (earned = true)));
            stop.push(rewarded.addAdEventListener(ads.AdEventType.CLOSED, () => finish(() => resolve({ earned }))));
            stop.push(rewarded.addAdEventListener(ads.AdEventType.ERROR, () => finish(() => reject(new Error('Ad failed to show')))));
            Promise.resolve(rewarded.show()).catch(() => finish(() => reject(new Error('Ad could not be shown'))));
          }),
      };
    },
  };
}
