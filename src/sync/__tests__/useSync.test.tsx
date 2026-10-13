import React from 'react';
import { AppState } from 'react-native';
import { act, create } from 'react-test-renderer';
import { useSync } from '../useSync';
import { flushPending } from '../flush';

jest.mock('../flush', () => ({ flushPending: jest.fn().mockResolvedValue({ synced: 0, failed: 0, remaining: 0 }) }));
jest.mock('../supabaseTransport', () => ({ supabaseTransport: {} }));

function Probe({ userId }: { userId: string | undefined }) {
  useSync(userId);
  return null;
}

describe('useSync', () => {
  let appStateHandler: ((state: string) => void) | undefined;
  const remove = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    appStateHandler = undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (state: string) => void) => {
      appStateHandler = handler;
      return { remove };
    }) as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('flushes on mount, when the app returns to the foreground, and on a timer', async () => {
    await act(async () => {
      create(<Probe userId="A" />);
    });
    expect(flushPending).toHaveBeenCalledTimes(1);
    expect(flushPending).toHaveBeenLastCalledWith('A', expect.anything());

    await act(async () => {
      appStateHandler?.('active');
    });
    expect(flushPending).toHaveBeenCalledTimes(2);

    await act(async () => {
      appStateHandler?.('background');
    });
    expect(flushPending).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });
    expect(flushPending).toHaveBeenCalledTimes(3);
  });

  it('does nothing without a signed-in user', async () => {
    await act(async () => {
      create(<Probe userId={undefined} />);
    });

    expect(flushPending).not.toHaveBeenCalled();
  });

  it('stops listening on unmount', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<Probe userId="A" />);
    });

    await act(async () => {
      tree.unmount();
    });
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });

    expect(remove).toHaveBeenCalled();
    expect(flushPending).toHaveBeenCalledTimes(1);
  });
});
