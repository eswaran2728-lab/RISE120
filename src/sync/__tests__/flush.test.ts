import { mockStore } from '../testing/storageMock';
import { enqueue, listPending } from '../queue';
import { flushPending } from '../flush';
import type { CheckinOperation, SyncTransport, WorkoutSetOperation } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../testing/storageMock').asyncStorageMock,
}));

const workoutSet = (id: string): WorkoutSetOperation => ({
  kind: 'workout_set',
  id,
  date: '2026-10-13',
  exerciseId: 'ex-1',
  setNumber: 1,
  reps: 10,
  weightKg: 20,
  updatedAt: 1000,
});

const checkin = (updatedAt: number, weightKg: number): CheckinOperation => ({
  kind: 'checkin',
  date: '2026-10-13',
  weightKg,
  mood: 3,
  sleepHours: 7,
  photoUri: null,
  updatedAt,
});

// A fake server keyed like the real one: sets by id, check-ins by (user, date).
function fakeServer() {
  const sets = new Map<string, WorkoutSetOperation>();
  const checkins = new Map<string, CheckinOperation>();
  const calls: string[] = [];
  const transport: SyncTransport = {
    upsertWorkoutSet: jest.fn(async (userId, op) => {
      calls.push(`set:${userId}:${op.id}`);
      sets.set(`${userId}:${op.id}`, op);
    }),
    upsertCheckin: jest.fn(async (userId, op) => {
      calls.push(`checkin:${userId}:${op.date}`);
      checkins.set(`${userId}:${op.date}`, op);
    }),
  };
  return { sets, checkins, calls, transport };
}

describe('flushPending', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('sends every pending operation once and empties the queue', async () => {
    const server = fakeServer();
    await enqueue('A', workoutSet('s1'));
    await enqueue('A', checkin(1000, 70));

    const result = await flushPending('A', server.transport);

    expect(result).toEqual({ synced: 2, failed: 0, remaining: 0 });
    expect(server.sets.size).toBe(1);
    expect(server.checkins.size).toBe(1);
    expect(await listPending('A')).toEqual([]);
  });

  it('leaves an operation pending when the transport fails, and stops there', async () => {
    const server = fakeServer();
    (server.transport.upsertWorkoutSet as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));
    await enqueue('A', workoutSet('s1'));
    await enqueue('A', workoutSet('s2'));

    const result = await flushPending('A', server.transport);

    expect(result).toEqual({ synced: 0, failed: 1, remaining: 2 });
    expect(server.sets.size).toBe(0);
  });

  it('creates exactly one server row when the response is lost and the flush is retried', async () => {
    const server = fakeServer();
    const original = server.transport.upsertWorkoutSet as jest.Mock;
    // First attempt reaches the server, but the reply is lost, so the client sees a failure.
    original.mockImplementationOnce(async (userId: string, op: WorkoutSetOperation) => {
      server.sets.set(`${userId}:${op.id}`, op);
      throw new Error('Network request failed');
    });
    await enqueue('A', workoutSet('s1'));

    await flushPending('A', server.transport);
    expect(await listPending('A')).toHaveLength(1);
    const retry = await flushPending('A', server.transport);

    expect(retry).toEqual({ synced: 1, failed: 0, remaining: 0 });
    expect(server.sets.size).toBe(1);
  });

  it('runs one flush at a time per account', async () => {
    const server = fakeServer();
    let release!: () => void;
    (server.transport.upsertWorkoutSet as jest.Mock).mockImplementationOnce(
      (userId: string, op: WorkoutSetOperation) =>
        new Promise<void>((resolve) => {
          release = () => {
            server.sets.set(`${userId}:${op.id}`, op);
            resolve();
          };
        })
    );
    await enqueue('A', workoutSet('s1'));

    const first = flushPending('A', server.transport);
    const second = flushPending('A', server.transport);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([first, second]);

    expect(server.transport.upsertWorkoutSet).toHaveBeenCalledTimes(1);
  });

  it('keeps a check-in edited while its flush was in flight', async () => {
    const server = fakeServer();
    let release!: () => void;
    (server.transport.upsertCheckin as jest.Mock).mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve))
    );
    await enqueue('A', checkin(1000, 70));

    const flushing = flushPending('A', server.transport);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await enqueue('A', checkin(2000, 71));
    release();
    await flushing;

    const pending = await listPending('A');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ weightKg: 71, updatedAt: 2000 });
  });

  it('never sends one account pending data under another account', async () => {
    const server = fakeServer();
    await enqueue('A', workoutSet('a-set'));
    await enqueue('B', workoutSet('b-set'));

    await flushPending('B', server.transport);

    expect(server.calls).toEqual(['set:B:b-set']);
    expect(await listPending('A')).toHaveLength(1);
  });

  it('reports an empty queue without calling the transport', async () => {
    const server = fakeServer();

    expect(await flushPending('A', server.transport)).toEqual({ synced: 0, failed: 0, remaining: 0 });
    expect(server.calls).toEqual([]);
  });
});
