import { mockStore } from '../../sync/testing/storageMock';
import { readCache, writeCache } from '../../cache/userCache';
import { loadHealth, saveHealth } from '../store';
import { syncHealth } from '../sync';
import { EMPTY_HEALTH_STATE, HealthState } from '../types';
import { fakeAdapter, fixedDeps, sleepNight, stepsFor } from '../testing/fakes';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

const connected = (over: Partial<HealthState> = {}): HealthState => ({ ...EMPTY_HEALTH_STATE, status: 'connected', connectedAt: '2026-10-01T00:00:00.000Z', permissions: { steps: true, sleep: true }, ...over });
// Index 29 of the 30-day window is 21 October, 28 is the 20th, 27 is the 19th.
const TODAY = 29;
const YESTERDAY = 28;

beforeEach(async () => {
  mockStore.clear();
  await saveHealth('A', connected());
});

describe('the first import', () => {
  it('stores steps and sleep by local day, with the apps they came from, and records when it read', async () => {
    const adapter = fakeAdapter({ steps: stepsFor({ [TODAY]: 4200, [YESTERDAY]: 9100 }), sleep: [sleepNight()] });

    const outcome = await syncHealth('A', fixedDeps(adapter));

    expect(outcome).toMatchObject({ kind: 'ok' });
    const state = await loadHealth('A');
    expect(state.steps['2026-10-21']).toMatchObject({ value: 4200, origins: ['com.phone.app'] });
    expect(state.steps['2026-10-20'].value).toBe(9100);
    expect(state.sleep['2026-10-20']).toMatchObject({ value: 450, origins: ['com.watch.app'] });
    expect(state).toMatchObject({ status: 'connected', lastSyncAt: '2026-10-21T04:00:00.000Z', lastSyncResult: 'ok' });
  });

  it('reads only steps and sleep: no other kind of data is asked for', async () => {
    const adapter = fakeAdapter();
    await syncHealth('A', fixedDeps(adapter));

    expect(adapter.calls.readSteps + adapter.calls.readSleep).toBe(2);
    expect(adapter.calls.request).toBe(0);
    expect(adapter.calls.revoke).toBe(0);
  });

  it('does nothing when the member has not connected', async () => {
    await saveHealth('A', EMPTY_HEALTH_STATE);
    const adapter = fakeAdapter();

    expect(await syncHealth('A', fixedDeps(adapter))).toEqual({ kind: 'not_connected' });
    expect(adapter.calls.readSteps + adapter.calls.readSleep + adapter.calls.granted).toBe(0);
  });
});

describe('duplicate, updated and deleted source records', () => {
  it('is the same after the same read again, however many times: no duplicate days, no changed revisions', async () => {
    const adapter = fakeAdapter({ steps: stepsFor({ [TODAY]: 4200 }), sleep: [sleepNight(), sleepNight()] });

    await syncHealth('A', fixedDeps(adapter));
    const first = await loadHealth('A');
    await syncHealth('A', fixedDeps(adapter));
    await syncHealth('A', fixedDeps(adapter));

    const later = await loadHealth('A');
    expect(later.steps).toEqual(first.steps);
    expect(later.sleep).toEqual(first.sleep);
    expect(Object.keys(later.sleep)).toHaveLength(1);
  });

  it('follows a source record that was changed', async () => {
    const adapter = fakeAdapter({ steps: stepsFor({ [TODAY]: 4200 }), sleep: [sleepNight()] });
    await syncHealth('A', fixedDeps(adapter));
    const before = (await loadHealth('A')).sleep['2026-10-20'].revision;

    adapter.state.script.steps = stepsFor({ [TODAY]: 5000 });
    adapter.state.script.sleep = [sleepNight({ end: '2026-10-19T23:00:00Z' })];
    await syncHealth('A', fixedDeps(adapter));

    const state = await loadHealth('A');
    expect(state.steps['2026-10-21'].value).toBe(5000);
    expect(state.sleep['2026-10-20']).toMatchObject({ value: 480 });
    expect(state.sleep['2026-10-20'].revision).not.toBe(before);
  });

  it('removes the copy of a day whose source records were deleted in Health Connect', async () => {
    const adapter = fakeAdapter({ steps: stepsFor({ [TODAY]: 4200, [YESTERDAY]: 9100 }), sleep: [sleepNight()] });
    await syncHealth('A', fixedDeps(adapter));

    adapter.state.script.steps = stepsFor({ [TODAY]: 4200 });
    adapter.state.script.sleep = [];
    await syncHealth('A', fixedDeps(adapter));

    const state = await loadHealth('A');
    expect(Object.keys(state.steps)).toEqual(['2026-10-21']);
    expect(state.sleep).toEqual({});
  });

  it('counts overlapping sleep from two apps once', async () => {
    const adapter = fakeAdapter({ sleep: [sleepNight({ id: 'p', origin: 'com.phone.app', end: '2026-10-19T22:00:00Z' }), sleepNight({ id: 'w', start: '2026-10-19T15:30:00Z' })] });

    await syncHealth('A', fixedDeps(adapter));

    expect((await loadHealth('A')).sleep['2026-10-20']).toMatchObject({ value: 450, origins: ['com.phone.app', 'com.watch.app'] });
  });

  it('keeps an older day it can no longer check, and drops what is older than the journey', async () => {
    await saveHealth('A', connected({
      steps: {
        '2026-09-15': { day: '2026-09-15', value: 7000, origins: ['a'], revision: '7000|a' },
        '2026-01-01': { day: '2026-01-01', value: 1, origins: ['a'], revision: '1|a' },
      },
    }));

    await syncHealth('A', fixedDeps(fakeAdapter()));

    const steps = (await loadHealth('A')).steps;
    expect(steps['2026-09-15']).toBeDefined();
    expect(steps['2026-01-01']).toBeUndefined();
  });
});

describe('time zones', () => {
  it('files a night under the day the person woke up in the phone\'s zone', async () => {
    const adapter = fakeAdapter({ sleep: [sleepNight({ endOffsetMinutes: null, end: '2026-10-20T16:30:00Z', start: '2026-10-20T09:00:00Z' })] });

    await syncHealth('A', fixedDeps(adapter, { offsetAt: () => 480 }));
    expect(Object.keys((await loadHealth('A')).sleep)).toEqual(['2026-10-21']);
  });

  it('does not move a night that was recorded with its own zone when the phone changes zone later', async () => {
    const adapter = fakeAdapter({ sleep: [sleepNight({ endOffsetMinutes: 480 })] });
    await syncHealth('A', fixedDeps(adapter, { offsetAt: () => 480 }));
    const before = await loadHealth('A');

    await syncHealth('A', fixedDeps(adapter, { offsetAt: () => -300 })); // the phone is now in New York

    expect((await loadHealth('A')).sleep).toEqual(before.sleep);
  });

  it('builds the window from the phone\'s local date, so late evening UTC is already tomorrow in Malaysia', async () => {
    let seen = '';
    const adapter = fakeAdapter({ steps: (window) => { seen = window.days[window.days.length - 1]; return window.days.map(() => ({ count: null, origins: [] })); } });

    await syncHealth('A', fixedDeps(adapter, { now: () => new Date('2026-10-21T17:30:00Z') }));

    expect(seen).toBe('2026-10-22');
  });
});

describe('permissions that change', () => {
  it('stops reading when access has been taken away, keeps what was imported, and says so', async () => {
    const adapter = fakeAdapter({ steps: stepsFor({ [TODAY]: 4200 }) });
    await syncHealth('A', fixedDeps(adapter));
    const reads = adapter.calls.readSteps;

    adapter.state.script.granted = { steps: false, sleep: false };
    const outcome = await syncHealth('A', fixedDeps(adapter));

    expect(outcome).toEqual({ kind: 'permission_lost' });
    expect(adapter.calls.readSteps).toBe(reads);
    const state = await loadHealth('A');
    expect(state.permissions).toEqual({ steps: false, sleep: false });
    expect(state.steps['2026-10-21'].value).toBe(4200);
    expect(state.status).toBe('connected');
  });

  it('keeps importing what is still allowed when only one permission is taken away', async () => {
    const adapter = fakeAdapter({ steps: stepsFor({ [TODAY]: 4200 }), sleep: [sleepNight()] });
    await syncHealth('A', fixedDeps(adapter));

    adapter.state.script.granted = { steps: true, sleep: false };
    adapter.state.script.steps = stepsFor({ [TODAY]: 6000 });
    adapter.state.script.sleep = [];
    const outcome = await syncHealth('A', fixedDeps(adapter));

    expect(outcome).toMatchObject({ kind: 'ok', missing: ['sleep'] });
    const state = await loadHealth('A');
    expect(state.steps['2026-10-21'].value).toBe(6000);
    expect(state.sleep['2026-10-20'].value).toBe(450); // not deleted by a read that was not allowed
    expect(state).toMatchObject({ permissions: { steps: true, sleep: false }, lastSyncResult: 'partial' });
  });

  it('resumes the other metric when its permission comes back', async () => {
    const adapter = fakeAdapter({ granted: { steps: true, sleep: false }, sleep: [sleepNight()] });
    await syncHealth('A', fixedDeps(adapter));
    expect(adapter.calls.readSleep).toBe(0);

    adapter.state.script.granted = { steps: true, sleep: true };
    await syncHealth('A', fixedDeps(adapter));

    expect((await loadHealth('A')).sleep['2026-10-20'].value).toBe(450);
  });

  it('reports an unsupported or unavailable device without touching the stored data', async () => {
    const adapter = fakeAdapter({ steps: stepsFor({ [TODAY]: 4200 }) });
    await syncHealth('A', fixedDeps(adapter));
    const before = await loadHealth('A');

    for (const availability of ['unsupported', 'unavailable', 'update_required'] as const) {
      adapter.state.script.availability = availability;
      expect(await syncHealth('A', fixedDeps(adapter))).toEqual({ kind: 'unsupported', availability });
    }

    expect(await loadHealth('A')).toEqual(before);
  });
});

describe('recovering from a failed read', () => {
  it('leaves everything as it was, records the failure, and the next read succeeds without duplicates', async () => {
    const adapter = fakeAdapter({ steps: stepsFor({ [TODAY]: 4200 }), sleep: [sleepNight()] });
    await syncHealth('A', fixedDeps(adapter));
    const before = await loadHealth('A');

    adapter.state.script.failSleep = true;
    adapter.state.script.steps = stepsFor({ [TODAY]: 9999 });
    const failed = await syncHealth('A', fixedDeps(adapter));

    expect(failed).toEqual({ kind: 'failed' });
    const after = await loadHealth('A');
    expect(after.steps).toEqual(before.steps); // nothing half-written
    expect(after.sleep).toEqual(before.sleep);
    expect(after).toMatchObject({ lastSyncResult: 'failed', lastSyncAt: before.lastSyncAt });

    adapter.state.script.failSleep = false;
    const retried = await syncHealth('A', fixedDeps(adapter));
    expect(retried).toMatchObject({ kind: 'ok' });
    expect((await loadHealth('A')).steps['2026-10-21'].value).toBe(9999);
    expect(Object.keys((await loadHealth('A')).sleep)).toHaveLength(1);
  });

  it('survives the stored copy being unreadable: it starts again as not connected rather than crashing', async () => {
    mockStore.set('rise120.cache.A.health', '{not json');

    expect((await loadHealth('A')).status).toBe('disconnected');
    expect(await syncHealth('A', fixedDeps(fakeAdapter()))).toEqual({ kind: 'not_connected' });
  });

  it('shares one read between two syncs started together', async () => {
    const adapter = fakeAdapter({ steps: stepsFor({ [TODAY]: 4200 }) });

    const [one, two] = await Promise.all([syncHealth('A', fixedDeps(adapter)), syncHealth('A', fixedDeps(adapter))]);

    expect(one).toEqual(two);
    expect(adapter.calls.readSteps).toBe(1);
  });
});

describe('accounts', () => {
  it('keeps each account\'s imported data apart', async () => {
    await saveHealth('B', connected());
    await syncHealth('A', fixedDeps(fakeAdapter({ steps: stepsFor({ [TODAY]: 4200 }) })));

    expect((await loadHealth('B')).steps).toEqual({});
    expect((await loadHealth('A')).steps['2026-10-21'].value).toBe(4200);
  });

  it('writes nothing for an account that was signed out while the read was running', async () => {
    const user = { current: 'A' as string | null };
    const adapter = fakeAdapter({ steps: stepsFor({ [TODAY]: 4200 }), onRead: () => { user.current = 'B'; } });
    await saveHealth('B', connected());

    const outcome = await syncHealth('A', fixedDeps(adapter, { user }));

    expect(outcome).toEqual({ kind: 'stale_account' });
    expect((await loadHealth('A')).steps).toEqual({});
    expect((await loadHealth('B')).steps).toEqual({});
  });

  it('writes nothing when nobody is signed in any more', async () => {
    const user = { current: 'A' as string | null };
    const adapter = fakeAdapter({ steps: stepsFor({ [TODAY]: 4200 }), onRead: () => { user.current = null; } });

    expect(await syncHealth('A', fixedDeps(adapter, { user }))).toEqual({ kind: 'stale_account' });
    expect((await loadHealth('A')).steps).toEqual({});
  });
});

describe('what it never touches', () => {
  it('leaves what the member typed alone', async () => {
    await writeCache('A', 'checkins', [{ date: '2026-10-20', weightKg: 70, mood: 3, sleepHours: 6.5 }]);
    const adapter = fakeAdapter({ steps: stepsFor({ [TODAY]: 4200 }), sleep: [sleepNight()] });

    await syncHealth('A', fixedDeps(adapter));

    expect(await readCache('A', 'checkins')).toEqual([{ date: '2026-10-20', weightKg: 70, mood: 3, sleepHours: 6.5 }]);
    expect((await loadHealth('A')).sleep['2026-10-20'].value).toBe(450); // kept apart, labelled as imported
  });
});
