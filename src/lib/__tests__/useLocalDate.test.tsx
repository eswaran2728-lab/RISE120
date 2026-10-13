import React from 'react';
import { AppState } from 'react-native';
import { act, create } from 'react-test-renderer';
import { useLocalDate } from '../useLocalDate';

function Probe({ onDate }: { onDate: (date: string) => void }) {
  onDate(useLocalDate());
  return null;
}

describe('useLocalDate', () => {
  let appStateHandler: ((state: string) => void) | undefined;
  const remove = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 9, 13, 23, 59, 30));
    appStateHandler = undefined;
    remove.mockClear();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (state: string) => void) => {
      appStateHandler = handler;
      return { remove };
    }) as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns the local date', async () => {
    let seen = '';
    await act(async () => {
      create(<Probe onDate={(d) => (seen = d)} />);
    });

    expect(seen).toBe('2026-10-13');
  });

  it('rolls over to the next day at local midnight without any user action', async () => {
    let seen = '';
    await act(async () => {
      create(<Probe onDate={(d) => (seen = d)} />);
    });

    await act(async () => {
      jest.advanceTimersByTime(60 * 1000);
    });

    expect(seen).toBe('2026-10-14');
  });

  it('refreshes when the app returns to the foreground after midnight', async () => {
    let seen = '';
    await act(async () => {
      create(<Probe onDate={(d) => (seen = d)} />);
    });

    jest.setSystemTime(new Date(2026, 9, 14, 7, 0, 0));
    await act(async () => {
      appStateHandler?.('active');
    });

    expect(seen).toBe('2026-10-14');
  });

  it('stops listening and clears its midnight timer on unmount', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<Probe onDate={() => undefined} />);
    });
    const clearSpy = jest.spyOn(global, 'clearTimeout');

    await act(async () => {
      tree.unmount();
    });

    expect(remove).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
  });
});
