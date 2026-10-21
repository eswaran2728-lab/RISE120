import { mockStore } from '../../sync/testing/storageMock';
import { clearUserCache, readCache, writeCache } from '../../cache/userCache';
import { enqueue, listPending } from '../../sync/queue';
import { connectHealth, disconnectHealth } from '../connection';
import { loadHealth, saveHealth } from '../store';
import { syncHealth } from '../sync';
import { EMPTY_HEALTH_STATE } from '../types';
import { fakeAdapter, fixedDeps, sleepNight, stepsFor } from '../testing/fakes';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

beforeEach(() => mockStore.clear());

describe('connecting', () => {
  it('connects only when the member allows access, then imports straight away', async () => {
    const adapter = fakeAdapter({ steps: stepsFor({ 29: 4200 }), sleep: [sleepNight()] });

    const outcome = await connectHealth('A', fixedDeps(adapter));

    expect(outcome).toMatchObject({ kind: 'connected', partial: [] });
    expect(adapter.calls.request).toBe(1);
    const state = await loadHealth('A');
    expect(state).toMatchObject({ status: 'connected', permissions: { steps: true, sleep: true }, connectedAt: '2026-10-21T04:00:00.000Z' });
    expect(state.steps['2026-10-21'].value).toBe(4200);
  });

  it('stays disconnected, imports nothing and reads nothing when the member says no', async () => {
    const adapter = fakeAdapter({ requestResult: { steps: false, sleep: false } });

    expect(await connectHealth('A', fixedDeps(adapter))).toEqual({ kind: 'denied' });

    expect((await loadHealth('A')).status).toBe('disconnected');
    expect(adapter.calls.readSteps + adapter.calls.readSleep).toBe(0);
  });

  it('connects with what was allowed when only one of the two is, and says which is missing', async () => {
    const adapter = fakeAdapter({ requestResult: { steps: true, sleep: false }, granted: { steps: true, sleep: false }, steps: stepsFor({ 29: 100 }), sleep: [sleepNight()] });

    const outcome = await connectHealth('A', fixedDeps(adapter));

    expect(outcome).toMatchObject({ kind: 'connected', partial: ['sleep'] });
    const state = await loadHealth('A');
    expect(state.permissions).toEqual({ steps: true, sleep: false });
    expect(state.sleep).toEqual({});
    expect(adapter.calls.readSleep).toBe(0);
  });

  it.each(['unsupported', 'unavailable', 'update_required'] as const)('does not ask for anything on a device where Health Connect is %s', async (availability) => {
    const adapter = fakeAdapter({ availability });

    expect(await connectHealth('A', fixedDeps(adapter))).toEqual({ kind: availability });

    expect(adapter.calls.request).toBe(0);
    expect((await loadHealth('A')).status).toBe('disconnected');
  });

  it('treats a failing permission dialog as an error, not as a connection', async () => {
    expect(await connectHealth('A', fixedDeps(fakeAdapter({ failRequest: true })))).toEqual({ kind: 'error' });
    expect((await loadHealth('A')).status).toBe('disconnected');
  });

  it('does not connect an account that was signed out while the permission dialog was open', async () => {
    const user = { current: 'A' as string | null };
    const adapter = fakeAdapter();
    const original = adapter.request.bind(adapter);
    adapter.request = async () => {
      user.current = 'B';
      return original();
    };

    expect(await connectHealth('A', fixedDeps(adapter, { user }))).toEqual({ kind: 'stale_account' });
    expect((await loadHealth('A')).status).toBe('disconnected');
    expect((await loadHealth('B')).status).toBe('disconnected');
  });

  it('starts clean when connecting again after a disconnect', async () => {
    const adapter = fakeAdapter({ steps: stepsFor({ 29: 4200 }) });
    await connectHealth('A', fixedDeps(adapter));
    await disconnectHealth('A', fixedDeps(adapter));

    const outcome = await connectHealth('A', fixedDeps(adapter));

    expect(outcome.kind).toBe('connected');
    expect(Object.keys((await loadHealth('A')).steps)).toEqual(['2026-10-21']);
  });
});

describe('disconnecting', () => {
  async function connectedAccount(user = 'A') {
    const adapter = fakeAdapter({ steps: stepsFor({ 29: 4200, 28: 9100 }), sleep: [sleepNight()] });
    await connectHealth(user, fixedDeps(adapter, { user: { current: user } }));
    return adapter;
  }

  it('asks Health Connect to drop the app\'s access, and removes every imported copy', async () => {
    const adapter = await connectedAccount();
    expect(Object.keys((await loadHealth('A')).steps)).toHaveLength(2);

    const outcome = await disconnectHealth('A', fixedDeps(adapter));

    expect(outcome).toEqual({ kind: 'disconnected', revoked: true });
    expect(adapter.calls.revoke).toBe(1);
    expect(await loadHealth('A')).toEqual(EMPTY_HEALTH_STATE);
  });

  it('removes the copies even when Health Connect cannot revoke, and says it could not', async () => {
    const adapter = await connectedAccount();
    adapter.state.script.failRevoke = true;

    const outcome = await disconnectHealth('A', fixedDeps(adapter));

    expect(outcome).toEqual({ kind: 'disconnected', revoked: false });
    expect(await loadHealth('A')).toEqual(EMPTY_HEALTH_STATE);
  });

  it('leaves manual entries alone: check-ins, queued logs and everything else the member typed', async () => {
    const adapter = await connectedAccount();
    await writeCache('A', 'checkins', [{ date: '2026-10-20', weightKg: 70, mood: 3, sleepHours: 6.5 }]);
    await enqueue('A', { kind: 'checkin', date: '2026-10-21', weightKg: 69.5, mood: 4, sleepHours: 7, photoUri: null, updatedAt: 1 });

    await disconnectHealth('A', fixedDeps(adapter));

    expect(await readCache('A', 'checkins')).toEqual([{ date: '2026-10-20', weightKg: 70, mood: 3, sleepHours: 6.5 }]);
    expect(await listPending('A')).toHaveLength(1);
  });

  it('stops all imports: a later sync reads nothing', async () => {
    const adapter = await connectedAccount();
    await disconnectHealth('A', fixedDeps(adapter));
    const reads = adapter.calls.readSteps + adapter.calls.readSleep;

    expect(await syncHealth('A', fixedDeps(adapter))).toEqual({ kind: 'not_connected' });

    expect(adapter.calls.readSteps + adapter.calls.readSleep).toBe(reads);
  });

  it('removes only this account\'s copies', async () => {
    const adapterA = await connectedAccount('A');
    await connectedAccount('B');

    await disconnectHealth('A', fixedDeps(adapterA));

    expect((await loadHealth('A')).status).toBe('disconnected');
    expect((await loadHealth('B')).status).toBe('connected');
    expect(Object.keys((await loadHealth('B')).steps)).toHaveLength(2);
  });

  it('is not undone by a sync that was already reading: the copies stay removed', async () => {
    const adapter = await connectedAccount();
    const deps = fixedDeps(adapter);
    const read = adapter.readSteps.bind(adapter);
    adapter.readSteps = async (window) => {
      await disconnectHealth('A', deps); // the member disconnects while Health Connect is being read
      return read(window);
    };

    const outcome = await syncHealth('A', deps);

    expect(outcome).toEqual({ kind: 'not_connected' });
    expect(await loadHealth('A')).toEqual(EMPTY_HEALTH_STATE);
  });

  it('still disconnects a member who has nothing imported', async () => {
    await saveHealth('A', { ...EMPTY_HEALTH_STATE, status: 'connected', permissions: { steps: true, sleep: true } });

    expect(await disconnectHealth('A', fixedDeps(fakeAdapter()))).toEqual({ kind: 'disconnected', revoked: true });
  });

  it('is removed with the account when the account is deleted', async () => {
    await connectedAccount();
    await clearUserCache('A');

    expect(await loadHealth('A')).toEqual(EMPTY_HEALTH_STATE);
  });
});
