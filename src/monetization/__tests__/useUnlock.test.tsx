import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { useUnlock } from '../useUnlock';
import { getRewardedAdService } from '../services';
import type { WatchResult } from '../rewardedAds';

let mockUserId = 'A';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../auth/useSession', () => ({ useSession: () => ({ session: { user: { id: mockUserId } } }) }));
jest.mock('../services', () => ({ getRewardedAdService: jest.fn() }));

type Unlock = ReturnType<typeof useUnlock>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('useUnlock', () => {
  let latest!: Unlock;
  const onChanged = jest.fn();
  const watch = jest.fn();

  function Probe() {
    latest = useUnlock({ rewardType: 'food', onChanged });
    return null;
  }
  const mount = async (): Promise<ReactTestRenderer> => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<Probe />);
    });
    return tree;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = 'A';
    (getRewardedAdService as jest.Mock).mockReturnValue({ watch });
  });

  it('opens the paywall for Subscribe without touching the ad flow', async () => {
    await mount();

    act(() => latest.run('subscribe'));

    expect(mockPush).toHaveBeenCalledWith('/paywall');
    expect(watch).not.toHaveBeenCalled();
  });

  it('runs a rewarded ad for the signed-in account and reports the outcome', async () => {
    watch.mockResolvedValue('credited' as WatchResult);
    await mount();

    await act(async () => latest.run('watch_ad'));

    expect(watch).toHaveBeenCalledWith('A', 'food');
    expect(latest.messageKey).toBe('limits.adCredited');
    expect(latest.busy).toBe(false);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("does not show A's ad outcome, or reload for it, after the user switched to B", async () => {
    const ad = deferred<WatchResult>();
    watch.mockReturnValue(ad.promise);
    const tree = await mount();
    await act(async () => latest.run('watch_ad'));
    expect(latest.busy).toBe(true);

    mockUserId = 'B';
    await act(async () => tree.update(<Probe />));
    await act(async () => ad.resolve('verifying'));

    expect(latest.messageKey).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does not let A's unfinished ad keep B's buttons busy", async () => {
    const ad = deferred<WatchResult>();
    watch.mockReturnValue(ad.promise);
    const tree = await mount();
    await act(async () => latest.run('watch_ad'));

    mockUserId = 'B';
    await act(async () => tree.update(<Probe />));

    expect(latest.busy).toBe(false);
    watch.mockResolvedValue('credited');
    await act(async () => latest.run('watch_ad'));
    expect(watch).toHaveBeenLastCalledWith('B', 'food');
    expect(latest.messageKey).toBe('limits.adCredited');
  });
});
