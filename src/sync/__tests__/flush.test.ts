import { mockStore } from '../testing/storageMock';
import { enqueue, listPending } from '../queue';
import { flushPending } from '../flush';
import { QuotaLimitError } from '../../monetization/errors';
import type { CheckinOperation, FoodLogOperation, SyncTransport, WorkoutSetOperation } from '../types';

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

const foodLog = (id: string, overrides: Partial<FoodLogOperation> = {}): FoodLogOperation => ({
  kind: 'food_log',
  id,
  date: '2026-10-13',
  foodId: 'food-1',
  quantity: 1,
  mealType: 'lunch',
  deleted: false,
  food: null,
  updatedAt: 1000,
  ...overrides,
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
  const foodLogs = new Map<string, FoodLogOperation>();
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
    upsertFoodLog: jest.fn(async (userId, op) => {
      calls.push(`food:${userId}:${op.id}`);
      foodLogs.set(`${userId}:${op.id}`, op);
    }),
    deleteFoodLog: jest.fn(async (userId, op) => {
      calls.push(`food-delete:${userId}:${op.id}`);
      foodLogs.delete(`${userId}:${op.id}`);
    }),
  };
  return { sets, checkins, foodLogs, calls, transport };
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

  it('leaves a failing operation pending but still sends the others', async () => {
    const server = fakeServer();
    (server.transport.upsertWorkoutSet as jest.Mock).mockRejectedValueOnce(new Error('Bad request'));
    await enqueue('A', workoutSet('s1'));
    await enqueue('A', workoutSet('s2'));
    await enqueue('A', checkin(1000, 70));

    const result = await flushPending('A', server.transport);

    expect(result).toEqual({ synced: 2, failed: 1, remaining: 1 });
    expect(server.sets.has('A:s2')).toBe(true);
    expect(server.checkins.size).toBe(1);
    expect((await listPending('A')).map((op) => op.kind === 'workout_set' && op.id)).toEqual(['s1']);
  });

  it('reports every item as failed while the network is down', async () => {
    const server = fakeServer();
    (server.transport.upsertWorkoutSet as jest.Mock).mockRejectedValue(new Error('Network request failed'));
    await enqueue('A', workoutSet('s1'));
    await enqueue('A', workoutSet('s2'));

    const result = await flushPending('A', server.transport);

    expect(result).toEqual({ synced: 0, failed: 2, remaining: 2 });
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

  describe('food logs', () => {
    it('upserts an added or edited log and deletes a tombstoned one', async () => {
      const server = fakeServer();
      await enqueue('A', foodLog('l1'));
      await enqueue('A', foodLog('l2', { deleted: true }));

      const result = await flushPending('A', server.transport);

      expect(result).toEqual({ synced: 2, failed: 0, remaining: 0 });
      expect(server.calls).toEqual(['food:A:l1', 'food-delete:A:l2']);
      expect(server.foodLogs.has('A:l1')).toBe(true);
    });

    it('creates exactly one server row when the response is lost and the flush is retried', async () => {
      const server = fakeServer();
      (server.transport.upsertFoodLog as jest.Mock).mockImplementationOnce(async (userId: string, op: FoodLogOperation) => {
        server.foodLogs.set(`${userId}:${op.id}`, op);
        throw new Error('Network request failed');
      });
      await enqueue('A', foodLog('l1'));

      await flushPending('A', server.transport);
      expect(await listPending('A')).toHaveLength(1);
      const retry = await flushPending('A', server.transport);

      expect(retry).toEqual({ synced: 1, failed: 0, remaining: 0 });
      expect(server.foodLogs.size).toBe(1);
    });

    it('keeps a delete queued when it fails, so it replays', async () => {
      const server = fakeServer();
      (server.transport.deleteFoodLog as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));
      await enqueue('A', foodLog('l1', { deleted: true }));

      expect(await flushPending('A', server.transport)).toEqual({ synced: 0, failed: 1, remaining: 1 });
      expect(await flushPending('A', server.transport)).toEqual({ synced: 1, failed: 0, remaining: 0 });
    });

    it('never sends one account food logs under another account', async () => {
      const server = fakeServer();
      await enqueue('A', foodLog('a-log'));
      await enqueue('B', foodLog('b-log'));

      await flushPending('B', server.transport);

      expect(server.calls).toEqual(['food:B:b-log']);
      expect(await listPending('A')).toHaveLength(1);
    });

    it('keeps a log edited while its flush was in flight', async () => {
      const server = fakeServer();
      let release!: () => void;
      (server.transport.upsertFoodLog as jest.Mock).mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
      await enqueue('A', foodLog('l1', { quantity: 1, updatedAt: 1000 }));

      const flushing = flushPending('A', server.transport);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await enqueue('A', foodLog('l1', { quantity: 3, updatedAt: 2000 }));
      release();
      await flushing;

      expect(await listPending('A')).toEqual([expect.objectContaining({ id: 'l1', quantity: 3 })]);
    });
  });
});

// A server that enforces a daily food capacity the way the database trigger does: a new id spends a
// slot, re-sending an id it already has does not, and a refusal carries the server's reset time.
describe('flushPending with the daily food limit', () => {
  const RESETS_AT = '2026-10-15T00:00:00.000Z';
  function limitedServer(capacity: number, options: { loseResponse?: boolean } = {}) {
    const state = { capacity, accepted: new Set<string>(), sets: new Set<string>(), checkins: new Set<string>(), loseResponse: !!options.loseResponse };
    const transport: SyncTransport = {
      upsertWorkoutSet: jest.fn(async (userId, op) => void state.sets.add(`${userId}:${op.id}`)),
      upsertCheckin: jest.fn(async (userId, op) => void state.checkins.add(`${userId}:${op.date}`)),
      upsertFoodLog: jest.fn(async (userId, op) => {
        const key = `${userId}:${op.id}`;
        if (!state.accepted.has(key)) {
          if ([...state.accepted].filter((k) => k.startsWith(`${userId}:`)).length >= state.capacity) {
            throw new QuotaLimitError({ kind: 'limit', limit: 'food', resetsAt: RESETS_AT });
          }
          state.accepted.add(key);
        }
        if (state.loseResponse) {
          state.loseResponse = false;
          throw new Error('Network request failed'); // stored, but the answer never arrived
        }
      }),
      deleteFoodLog: jest.fn(async (userId, op) => void state.accepted.delete(`${userId}:${op.id}`)),
    };
    return { state, transport };
  }

  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('keeps the refused food log queued with a typed reason and the server reset time', async () => {
    const server = limitedServer(2);
    await enqueue('A', foodLog('f1'));
    await enqueue('A', foodLog('f2'));
    await enqueue('A', foodLog('f3', { updatedAt: 3000 }));

    const result = await flushPending('A', server.transport);

    expect(result).toEqual({ synced: 2, failed: 1, remaining: 1 });
    expect(await listPending('A')).toEqual([foodLog('f3', { updatedAt: 3000, blocked: { kind: 'limit', limit: 'food', resetsAt: RESETS_AT } })]);
  });

  it('keeps syncing every other queued operation past the refused food log', async () => {
    const server = limitedServer(0);
    await enqueue('A', foodLog('f1'));
    await enqueue('A', workoutSet('s1'));
    await enqueue('A', checkin(2000, 70));
    await enqueue('A', foodLog('f2'));

    const result = await flushPending('A', server.transport);

    expect(result).toEqual({ synced: 2, failed: 2, remaining: 2 });
    expect(server.state.sets.has('A:s1')).toBe(true);
    expect(server.state.checkins.has('A:2026-10-13')).toBe(true);
    expect((await listPending('A')).map((op) => op.kind === 'food_log' && op.id)).toEqual(['f1', 'f2']);
  });

  it('keeps the blocked entry, its reason and its id across an app restart', async () => {
    await enqueue('A', foodLog('f1'));
    await flushPending('A', limitedServer(0).transport);

    let reloaded!: typeof import('../queue');
    jest.isolateModules(() => {
      reloaded = jest.requireActual('../queue');
    });

    expect(await reloaded.listPending('A')).toEqual([foodLog('f1', { blocked: { kind: 'limit', limit: 'food', resetsAt: RESETS_AT } })]);
  });

  it.each([
    ['the limit resets'],
    ['a verified ad reward adds capacity'],
    ['the user becomes premium'],
  ])('syncs the same log with the same id once capacity appears because %s', async () => {
    const server = limitedServer(0);
    await enqueue('A', foodLog('f1'));
    await flushPending('A', server.transport);
    expect(await listPending('A')).toHaveLength(1);

    server.state.capacity = 5; // the server now has room

    expect(await flushPending('A', server.transport)).toEqual({ synced: 1, failed: 0, remaining: 0 });
    expect([...server.state.accepted]).toEqual(['A:f1']);
    expect(await listPending('A')).toEqual([]);
  });

  it('retries only as capacity allows: an ad reward of two lets two of three through, in order', async () => {
    const server = limitedServer(0);
    for (const id of ['f1', 'f2', 'f3']) await enqueue('A', foodLog(id));
    await flushPending('A', server.transport);
    server.state.capacity = 2;

    await flushPending('A', server.transport);

    expect([...server.state.accepted]).toEqual(['A:f1', 'A:f2']);
    expect((await listPending('A')).map((op) => op.kind === 'food_log' && op.id)).toEqual(['f3']);
  });

  it('refreshes the reason when a retry is refused again', async () => {
    const server = limitedServer(0);
    await enqueue('A', foodLog('f1'));
    await flushPending('A', server.transport);
    (server.transport.upsertFoodLog as jest.Mock).mockRejectedValueOnce(
      new QuotaLimitError({ kind: 'limit', limit: 'food', resetsAt: '2026-10-16T00:00:00.000Z' })
    );

    await flushPending('A', server.transport);

    expect((await listPending('A'))[0]).toMatchObject({ id: 'f1', blocked: { resetsAt: '2026-10-16T00:00:00.000Z' } });
  });

  it('does not mark an ordinary failure as a limit', async () => {
    const server = limitedServer(5);
    (server.transport.upsertFoodLog as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));
    await enqueue('A', foodLog('f1'));

    await flushPending('A', server.transport);

    expect(await listPending('A')).toEqual([foodLog('f1')]);
  });

  it('does not spend a second slot or duplicate the meal when the first answer was lost', async () => {
    const server = limitedServer(1, { loseResponse: true });
    await enqueue('A', foodLog('f1'));

    await flushPending('A', server.transport); // stored on the server, answer lost
    expect(await listPending('A')).toHaveLength(1);
    await flushPending('A', server.transport); // same id again: no new slot, no refusal

    expect([...server.state.accepted]).toEqual(['A:f1']);
    expect(await listPending('A')).toEqual([]);
  });

  it('drops the reason when the user edits the entry, and a new refusal sets it again', async () => {
    const server = limitedServer(0);
    await enqueue('A', foodLog('f1', { quantity: 1 }));
    await flushPending('A', server.transport);

    await enqueue('A', foodLog('f1', { quantity: 2, updatedAt: 2000 }));
    expect(await listPending('A')).toEqual([foodLog('f1', { quantity: 2, updatedAt: 2000 })]);

    await flushPending('A', server.transport);
    expect((await listPending('A'))[0]).toMatchObject({ id: 'f1', quantity: 2, blocked: { kind: 'limit' } });
  });

  it('lets a delete of a blocked entry go through and clears it', async () => {
    const server = limitedServer(0);
    await enqueue('A', foodLog('f1'));
    await flushPending('A', server.transport);

    await enqueue('A', foodLog('f1', { deleted: true, updatedAt: 2000 }));
    await flushPending('A', server.transport);

    expect(await listPending('A')).toEqual([]);
  });

  it("never shows account A's blocked entry to account B, and B keeps syncing on its own", async () => {
    const server = limitedServer(0);
    await enqueue('A', foodLog('f1'));
    await flushPending('A', server.transport);
    await enqueue('B', workoutSet('s9'));

    expect(await listPending('B')).toEqual([workoutSet('s9')]);
    expect(await flushPending('B', server.transport)).toEqual({ synced: 1, failed: 0, remaining: 0 });
    expect(await listPending('A')).toHaveLength(1);
    expect((await listPending('A'))[0]).toMatchObject({ blocked: { kind: 'limit' } });
  });
});
