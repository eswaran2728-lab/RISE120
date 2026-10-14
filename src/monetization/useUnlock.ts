import { useCallback, useEffect, useRef, useState } from 'react';
import { Href, useRouter } from 'expo-router';
import { useSession } from '../auth/useSession';
import type { UnlockAction } from './limits';
import { RewardType, WatchResult } from './rewardedAds';
import { getRewardedAdService } from './services';

// The user-facing line for each way a rewarded ad can end. "dismissed" says nothing: the user chose to leave.
const AD_MESSAGE_KEYS: Record<WatchResult, string | null> = {
  credited: 'limits.adCredited',
  verifying: 'limits.adVerifying',
  dismissed: null,
  load_failed: 'limits.adFailed',
  failed: 'limits.adFailed',
  premium: 'limits.adPremium',
  cap_reached: 'limits.adCap',
  unavailable: 'limits.adUnavailable',
  wrong_account: 'limits.adFailed',
};

interface Options {
  rewardType: RewardType;
  // Called after an ad finished (credited or still verifying) so the screen can reload and retry pending work.
  onChanged?: () => void;
}

// Runs the actions offered on a limit notice: Subscribe opens the paywall, Watch ad runs the rewarded-ad flow.
export function useUnlock({ rewardType, onChanged }: Options) {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const [busy, setBusy] = useState(false);
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const mounted = useRef(true);
  const changed = useRef(onChanged);

  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    (action: UnlockAction) => {
      if (action === 'subscribe') {
        router.push('/paywall' as Href);
        return;
      }
      if (!userId || busy) return;
      setBusy(true);
      setMessageKey(null);
      void getRewardedAdService()
        .watch(userId, rewardType)
        .then((result) => {
          if (!mounted.current) return;
          setMessageKey(AD_MESSAGE_KEYS[result]);
          if (result === 'credited' || result === 'verifying') changed.current?.();
        })
        .catch(() => mounted.current && setMessageKey('limits.adFailed'))
        .finally(() => mounted.current && setBusy(false));
    },
    [router, userId, busy, rewardType]
  );

  return { run, busy, messageKey };
}
