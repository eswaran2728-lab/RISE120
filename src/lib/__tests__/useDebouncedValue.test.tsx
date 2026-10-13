import React from 'react';
import { act, create } from 'react-test-renderer';
import { useDebouncedValue } from '../useDebouncedValue';

function Probe({ value, onValue }: { value: string; onValue: (v: string) => void }) {
  onValue(useDebouncedValue(value, 300));
  return null;
}

describe('useDebouncedValue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns the first value immediately', async () => {
    let seen = '';
    await act(async () => {
      create(<Probe value="a" onValue={(v) => (seen = v)} />);
    });

    expect(seen).toBe('a');
  });

  it('waits for typing to pause before updating, and only keeps the last value', async () => {
    let seen = '';
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<Probe value="n" onValue={(v) => (seen = v)} />);
    });

    for (const typed of ['na', 'nas', 'nasi']) {
      await act(async () => {
        tree.update(<Probe value={typed} onValue={(v) => (seen = v)} />);
        jest.advanceTimersByTime(100);
      });
    }
    expect(seen).toBe('n');

    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(seen).toBe('nasi');
  });

  it('clears its timer on unmount', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<Probe value="a" onValue={() => undefined} />);
    });
    await act(async () => {
      tree.update(<Probe value="ab" onValue={() => undefined} />);
    });
    const clearSpy = jest.spyOn(global, 'clearTimeout');

    await act(async () => {
      tree.unmount();
    });

    expect(clearSpy).toHaveBeenCalled();
  });
});
