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

// What an ad run has shown so far, tagged with the account that started it.
interface Run {
  userId: string;
  busy: boolean;
  messageKey: string | null;
}

// Runs the actions offered on a limit notice: Subscribe opens the paywall, Watch ad runs the rewarded-ad flow.
export function useUnlock({ rewardType, onChanged }: Options) {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const [state, setState] = useState<Run | null>(null);
  // Only the current account's run is ever shown, so another account's ad can neither keep these buttons busy
  // nor leave its message behind.
  const run_ = state && state.userId === userId ? state : null;
  const mounted = useRef(true);
  const activeUser = useRef(userId);
  const changed = useRef(onChanged);

  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);
  useEffect(() => {
    activeUser.current = userId;
  }, [userId]);
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
      if (!userId || run_?.busy) return;
      const forUser = userId;
      const stillCurrent = () => mounted.current && activeUser.current === forUser;
      setState({ userId: forUser, busy: true, messageKey: null });
      void getRewardedAdService()
        .watch(forUser, rewardType)
        .then((result) => {
          if (!stillCurrent()) return;
          setState({ userId: forUser, busy: true, messageKey: AD_MESSAGE_KEYS[result] });
          if (result === 'credited' || result === 'verifying') changed.current?.();
        })
        .catch(() => stillCurrent() && setState({ userId: forUser, busy: true, messageKey: 'limits.adFailed' }))
        .finally(() => stillCurrent() && setState((prev) => (prev && prev.userId === forUser ? { ...prev, busy: false } : prev)));
    },
    [router, userId, run_?.busy, rewardType]
  );

  return { run, busy: run_?.busy ?? false, messageKey: run_?.messageKey ?? null };
}
