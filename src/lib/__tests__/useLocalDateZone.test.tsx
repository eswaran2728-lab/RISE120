import React from 'react';
import { AppState } from 'react-native';
import { act, create } from 'react-test-renderer';
import { useLocalDate } from '../useLocalDate';

function Probe({ zone, onDate }: { zone?: string | null; onDate: (date: string) => void }) {
  onDate(useLocalDate(zone));
  return null;
}

describe('useLocalDate with a journey time zone', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows the date in the member\'s zone and rolls over at that zone\'s midnight', async () => {
    jest.setSystemTime(new Date('2026-10-18T15:59:50Z')); // 23:59:50 in Kuala Lumpur
    let seen = '';
    await act(async () => {
      create(<Probe zone="Asia/Kuala_Lumpur" onDate={(d) => (seen = d)} />);
    });
    expect(seen).toBe('2026-10-18');

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });

    expect(seen).toBe('2026-10-19');
  });

  it('does not roll over at UTC midnight when the zone is Kuala Lumpur', async () => {
    jest.setSystemTime(new Date('2026-10-18T23:59:50Z')); // already 07:59 on 19 October in Kuala Lumpur
    let seen = '';
    await act(async () => {
      create(<Probe zone="Asia/Kuala_Lumpur" onDate={(d) => (seen = d)} />);
    });
    expect(seen).toBe('2026-10-19');

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });

    expect(seen).toBe('2026-10-19');
  });

  it('switches when the zone changes (a new cycle chose another zone)', async () => {
    jest.setSystemTime(new Date('2026-10-17T17:00:00Z'));
    let seen = '';
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<Probe zone="UTC" onDate={(d) => (seen = d)} />);
    });
    expect(seen).toBe('2026-10-17');

    await act(async () => {
      tree.update(<Probe zone="Asia/Kuala_Lumpur" onDate={(d) => (seen = d)} />);
    });

    expect(seen).toBe('2026-10-18');
  });
});
