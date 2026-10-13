import { mockStore } from '../../sync/testing/storageMock';
import { listPending } from '../../sync/queue';
import {
  formatClock,
  mergeSets,
  nextSetNumber,
  parseSetFields,
  queueWorkoutSet,
  restRemaining,
  setLogId,
  summarizeSession,
} from '../log';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('parseSetFields', () => {
  it('accepts reps and a decimal-comma weight in kilograms', () => {
    expect(parseSetFields({ reps: '10', weight: '22,5', units: 'metric' })).toEqual({ ok: true, reps: 10, weightKg: 22.5 });
  });

  it('converts pounds to kilograms rounded to 0.1', () => {
    expect(parseSetFields({ reps: '8', weight: '50', units: 'imperial' })).toEqual({ ok: true, reps: 8, weightKg: 22.7 });
  });

  it('treats a blank weight as bodyweight (0 kg)', () => {
    expect(parseSetFields({ reps: '12', weight: '  ', units: 'metric' })).toEqual({ ok: true, reps: 12, weightKg: 0 });
  });

  it.each([
    [{ reps: '', weight: '10' }, 'reps', 'invalid'],
    [{ reps: 'abc', weight: '10' }, 'reps', 'invalid'],
    [{ reps: '8.5', weight: '10' }, 'reps', 'invalid'],
    [{ reps: '0', weight: '10' }, 'reps', 'min'],
    [{ reps: '101', weight: '10' }, 'reps', 'max'],
    [{ reps: '10', weight: 'abc' }, 'weight', 'invalid'],
    [{ reps: '10', weight: '501' }, 'weight', 'max'],
  ])('rejects %j as %s %s', (fields, field, reason) => {
    expect(parseSetFields({ ...fields, units: 'metric' })).toEqual({ ok: false, field, reason });
  });
});

describe('setLogId', () => {
  it('is a stable valid UUID for the same user, day, exercise and set', () => {
    const id = setLogId('u1', '2026-10-13', 'ex-1', 1);

    expect(id).toMatch(UUID);
    expect(setLogId('u1', '2026-10-13', 'ex-1', 1)).toBe(id);
  });

  it('differs when any part changes', () => {
    const ids = new Set([
      setLogId('u1', '2026-10-13', 'ex-1', 1),
      setLogId('u2', '2026-10-13', 'ex-1', 1),
      setLogId('u1', '2026-10-14', 'ex-1', 1),
      setLogId('u1', '2026-10-13', 'ex-2', 1),
      setLogId('u1', '2026-10-13', 'ex-1', 2),
    ]);

    expect(ids.size).toBe(5);
  });
});

describe('queueWorkoutSet', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  const input = { exerciseId: 'ex-1', setNumber: 1, reps: '10', weight: '20', units: 'metric' as const };

  it('queues the set and returns its stable id', async () => {
    const id = await queueWorkoutSet('u1', '2026-10-13', input);

    expect(id).toBe(setLogId('u1', '2026-10-13', 'ex-1', 1));
    expect(await listPending('u1')).toEqual([
      expect.objectContaining({ kind: 'workout_set', id, date: '2026-10-13', exerciseId: 'ex-1', setNumber: 1, reps: 10, weightKg: 20 }),
    ]);
  });

  it('creates one pending set after a double tap', async () => {
    await Promise.all([queueWorkoutSet('u1', '2026-10-13', input), queueWorkoutSet('u1', '2026-10-13', input)]);

    expect(await listPending('u1')).toHaveLength(1);
  });

  it('keeps different accounts separate', async () => {
    await queueWorkoutSet('u1', '2026-10-13', input);

    expect(await listPending('u2')).toEqual([]);
  });

  it('stores pounds as kilograms', async () => {
    await queueWorkoutSet('u1', '2026-10-13', { ...input, weight: '50', units: 'imperial' });

    expect((await listPending('u1'))[0]).toMatchObject({ weightKg: 22.7 });
  });

  it('rejects an invalid set and queues nothing', async () => {
    await expect(queueWorkoutSet('u1', '2026-10-13', { ...input, reps: '0' })).rejects.toThrow();

    expect(await listPending('u1')).toEqual([]);
  });
});

describe('summarizeSession', () => {
  it('totals sets, reps and volume', () => {
    expect(
      summarizeSession([
        { reps: 10, weightKg: 20 },
        { reps: 8, weightKg: 22.5 },
      ])
    ).toEqual({ completedSets: 2, totalReps: 18, volumeKg: 380 });
  });

  it('handles an empty session and bodyweight sets', () => {
    expect(summarizeSession([])).toEqual({ completedSets: 0, totalReps: 0, volumeKg: 0 });
    expect(summarizeSession([{ reps: 12, weightKg: 0 }])).toEqual({ completedSets: 1, totalReps: 12, volumeKg: 0 });
  });

  it('avoids floating-point noise in volume', () => {
    expect(summarizeSession([{ reps: 3, weightKg: 0.1 }, { reps: 3, weightKg: 0.2 }]).volumeKg).toBe(0.9);
  });
});

describe('mergeSets and nextSetNumber', () => {
  const server = [
    { id: 'a', exerciseId: 'ex-1', setNumber: 1, reps: 10, weightKg: 20 },
    { id: 'b', exerciseId: 'ex-1', setNumber: 2, reps: 10, weightKg: 20 },
  ];
  const pending = [
    { id: 'b', exerciseId: 'ex-1', setNumber: 2, reps: 9, weightKg: 20 },
    { id: 'c', exerciseId: 'ex-1', setNumber: 3, reps: 8, weightKg: 20 },
  ];

  it('shows each set once, preferring the pending (newer) copy, ordered by set number', () => {
    const merged = mergeSets(server, pending);

    expect(merged.map((s) => [s.id, s.reps, s.pending])).toEqual([
      ['a', 10, false],
      ['b', 9, true],
      ['c', 8, true],
    ]);
  });

  it('picks the next set number per exercise', () => {
    const merged = mergeSets(server, pending);

    expect(nextSetNumber(merged, 'ex-1')).toBe(4);
    expect(nextSetNumber(merged, 'ex-2')).toBe(1);
  });
});

describe('restRemaining and formatClock', () => {
  it('counts down from device timestamps', () => {
    expect(restRemaining(0, 15000, 60)).toBe(45);
  });

  it('keeps counting correctly after the app was in the background', () => {
    expect(restRemaining(1000, 1000 + 50000, 60)).toBe(10);
  });

  it('never goes below zero or above the duration', () => {
    expect(restRemaining(0, 120000, 60)).toBe(0);
    expect(restRemaining(10000, 5000, 60)).toBe(60);
  });

  it('formats minutes and seconds', () => {
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(0)).toBe('0:00');
  });
});
