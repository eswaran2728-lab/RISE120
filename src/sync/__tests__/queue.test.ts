import { mockStore } from '../testing/storageMock';
import { clearPending, clearPhotoUri, enqueue, listPending } from '../queue';
import type { CheckinOperation, WorkoutSetOperation } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../testing/storageMock').asyncStorageMock,
}));

const workoutSet = (overrides: Partial<WorkoutSetOperation> = {}): WorkoutSetOperation => ({
  kind: 'workout_set',
  id: 'set-1',
  date: '2026-10-13',
  exerciseId: 'ex-1',
  setNumber: 1,
  reps: 10,
  weightKg: 20,
  updatedAt: 1000,
  ...overrides,
});

const checkin = (overrides: Partial<CheckinOperation> = {}): CheckinOperation => ({
  kind: 'checkin',
  date: '2026-10-13',
  weightKg: 70.5,
  mood: 3,
  sleepHours: 7,
  photoUri: null,
  updatedAt: 1000,
  ...overrides,
});

describe('offline queue', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('keeps operations offline and returns them in order', async () => {
    await enqueue('A', workoutSet({ id: 'set-1' }));
    await enqueue('A', checkin());

    expect((await listPending('A')).map((op) => op.kind)).toEqual(['workout_set', 'checkin']);
  });

  it('survives a process restart', async () => {
    await enqueue('A', workoutSet());

    let reloaded!: typeof import('../queue');
    jest.isolateModules(() => {
      reloaded = jest.requireActual('../queue');
    });

    expect(await reloaded.listPending('A')).toEqual([workoutSet()]);
  });

  it('creates one entry when the same set is enqueued twice (double tap)', async () => {
    await Promise.all([enqueue('A', workoutSet()), enqueue('A', workoutSet())]);

    expect(await listPending('A')).toHaveLength(1);
  });

  it('keeps concurrent enqueues of different sets without losing any', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => enqueue('A', workoutSet({ id: `set-${i}`, setNumber: i + 1 }))));

    expect(await listPending('A')).toHaveLength(10);
  });

  it('keeps one check-in per date and lets the latest edit win', async () => {
    await enqueue('A', checkin({ weightKg: 70, updatedAt: 1000 }));
    await enqueue('A', checkin({ weightKg: 71, updatedAt: 2000 }));
    await enqueue('A', checkin({ weightKg: 99, updatedAt: 1500 }));

    const pending = await listPending('A');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ weightKg: 71, updatedAt: 2000 });
  });

  it('keeps different check-in dates separate', async () => {
    await enqueue('A', checkin({ date: '2026-10-13' }));
    await enqueue('A', checkin({ date: '2026-10-14' }));

    expect(await listPending('A')).toHaveLength(2);
  });

  it('scopes pending entries to the user', async () => {
    await enqueue('A', workoutSet());

    expect(await listPending('B')).toEqual([]);
    expect(await listPending('A')).toHaveLength(1);
  });

  it('clearPending removes only that user data', async () => {
    await enqueue('A', workoutSet());
    await enqueue('B', workoutSet({ id: 'set-b' }));

    await clearPending('A');

    expect(await listPending('A')).toEqual([]);
    expect(await listPending('B')).toHaveLength(1);
  });

  it('treats a corrupt stored queue as empty', async () => {
    mockStore.set('rise120.sync.pending.A', '{not json');

    expect(await listPending('A')).toEqual([]);
  });

  it('keeps a pending photo when the same check-in date is edited without a new photo', async () => {
    await enqueue('A', checkin({ photoUri: 'file:///docs/photo.jpg', updatedAt: 1000 }));
    await enqueue('A', checkin({ weightKg: 71, photoUri: null, updatedAt: 2000 }));

    expect((await listPending('A'))[0]).toMatchObject({ weightKg: 71, photoUri: 'file:///docs/photo.jpg' });
  });

  it('clearPhotoUri drops an uploaded photo reference from a newer queued edit, and only that photo', async () => {
    await enqueue('A', checkin({ photoUri: 'file:///docs/new.jpg', updatedAt: 1000 }));

    await clearPhotoUri('A', '2026-10-13', 'file:///docs/other.jpg');
    expect((await listPending('A'))[0]).toMatchObject({ photoUri: 'file:///docs/new.jpg' });

    await clearPhotoUri('A', '2026-10-13', 'file:///docs/new.jpg');
    expect((await listPending('A'))[0]).toMatchObject({ photoUri: null, updatedAt: 1000 });
  });
});
