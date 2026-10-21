import { createHealthConnectAdapter, READ_PERMISSIONS } from '../adapter';
import { buildWindow } from '../days';

const android = { OS: 'android', Version: 34 };
const window = buildWindow('2026-10-21', 3, () => 480);

// A scripted stand-in for react-native-health-connect. SYNTHETIC; the real native module is only exercised on a phone.
function fakeLibrary(over: Record<string, unknown> = {}) {
  const lib = {
    getSdkStatus: jest.fn().mockResolvedValue(3),
    initialize: jest.fn().mockResolvedValue(true),
    getGrantedPermissions: jest.fn().mockResolvedValue([]),
    requestPermission: jest.fn().mockResolvedValue([]),
    aggregateGroupByPeriod: jest.fn().mockResolvedValue([]),
    readRecords: jest.fn().mockResolvedValue({ records: [] }),
    revokeAllPermissions: jest.fn().mockResolvedValue({ revoked: true }),
    openHealthConnectSettings: jest.fn(),
    insertRecords: jest.fn(),
    deleteRecordsByUuids: jest.fn(),
    deleteRecordsByTimeRange: jest.fn(),
    ...over,
  };
  return lib;
}
const adapterFor = (lib: ReturnType<typeof fakeLibrary>, platform: { OS: string; Version: string | number } = android) => createHealthConnectAdapter({ platform, loadLibrary: () => lib });

describe('availability', () => {
  it.each([
    ['iOS', { OS: 'ios', Version: '17' }],
    ['web', { OS: 'web', Version: 0 }],
    ['Android 8', { OS: 'android', Version: 26 }],
  ])('is unsupported on %s, without calling the native module', async (_name, platform) => {
    const lib = fakeLibrary();

    expect(await adapterFor(lib, platform).availability()).toBe('unsupported');
    expect(lib.getSdkStatus).not.toHaveBeenCalled();
  });

  it.each([
    [3, 'available'],
    [2, 'update_required'],
    [1, 'unavailable'],
    [99, 'unsupported'],
  ])('maps the SDK status %s to %s on Android 9 and later', async (status, expected) => {
    expect(await adapterFor(fakeLibrary({ getSdkStatus: jest.fn().mockResolvedValue(status) }), { OS: 'android', Version: 28 }).availability()).toBe(expected);
  });

  it('is unsupported when this build has no native Health Connect module', async () => {
    const adapter = createHealthConnectAdapter({ platform: android, loadLibrary: () => { throw new Error('not linked'); } });

    expect(await adapter.availability()).toBe('unsupported');
  });

  it('is unsupported when asking the native module fails', async () => {
    expect(await adapterFor(fakeLibrary({ getSdkStatus: jest.fn().mockRejectedValue(new Error('boom')) })).availability()).toBe('unsupported');
  });
});

describe('permissions', () => {
  it('asks for exactly two READ permissions, steps and sleep, and nothing else', async () => {
    const lib = fakeLibrary({ requestPermission: jest.fn().mockResolvedValue([{ accessType: 'read', recordType: 'Steps' }]) });

    const granted = await adapterFor(lib).request();

    expect(lib.requestPermission).toHaveBeenCalledWith([
      { accessType: 'read', recordType: 'Steps' },
      { accessType: 'read', recordType: 'SleepSession' },
    ]);
    expect(granted).toEqual({ steps: true, sleep: false });
    expect(READ_PERMISSIONS.every((p) => p.accessType === 'read')).toBe(true);
    expect(READ_PERMISSIONS.map((p) => p.recordType)).toEqual(['Steps', 'SleepSession']);
  });

  it('reads the permissions the system currently grants, ignoring write and other types', async () => {
    const lib = fakeLibrary({
      getGrantedPermissions: jest.fn().mockResolvedValue([
        { accessType: 'write', recordType: 'Steps' },
        { accessType: 'read', recordType: 'SleepSession' },
        { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
      ]),
    });

    expect(await adapterFor(lib).granted()).toEqual({ steps: false, sleep: true });
  });

  it('initialises the native module once', async () => {
    const lib = fakeLibrary();
    const adapter = adapterFor(lib);

    await adapter.granted();
    await adapter.granted();
    await adapter.request();

    expect(lib.initialize).toHaveBeenCalledTimes(1);
  });
});

describe('reading', () => {
  it('asks for one total per local day for the whole window in a single aggregate (so apps are not double counted)', async () => {
    const lib = fakeLibrary({
      aggregateGroupByPeriod: jest.fn().mockResolvedValue([
        { startTime: '2026-10-19T00:00:00', endTime: '2026-10-20T00:00:00', result: { COUNT_TOTAL: 4000, dataOrigins: ['com.phone.app'] } },
        { startTime: '2026-10-20T00:00:00', endTime: '2026-10-21T00:00:00', result: { COUNT_TOTAL: 0, dataOrigins: [] } },
        { startTime: '2026-10-21T00:00:00', endTime: '2026-10-22T00:00:00', result: { COUNT_TOTAL: 8100, dataOrigins: ['com.watch.app'] } },
      ]),
    });

    const groups = await adapterFor(lib).readSteps(window);

    expect(lib.aggregateGroupByPeriod).toHaveBeenCalledWith({
      recordType: 'Steps',
      timeRangeFilter: { operator: 'between', startTime: window.starts[0], endTime: window.end },
      timeRangeSlicer: { period: 'DAYS', length: 1 },
    });
    expect(groups).toEqual([{ count: 4000, origins: ['com.phone.app'] }, { count: 0, origins: [] }, { count: 8100, origins: ['com.watch.app'] }]);
  });

  it('refuses to guess when the days come back misaligned: wrong count, or labelled as other days', async () => {
    const wrongCount = fakeLibrary({ aggregateGroupByPeriod: jest.fn().mockResolvedValue([{ result: { COUNT_TOTAL: 1, dataOrigins: [] } }]) });
    const wrongLabel = fakeLibrary({
      aggregateGroupByPeriod: jest.fn().mockResolvedValue(window.days.map((_, i) => ({ startTime: `2026-09-0${i + 1}T00:00:00`, result: { COUNT_TOTAL: 1, dataOrigins: [] } }))),
    });

    await expect(adapterFor(wrongCount).readSteps(window)).rejects.toThrow('misaligned');
    await expect(adapterFor(wrongLabel).readSteps(window)).rejects.toThrow('misaligned');
  });

  it('reads sleep sessions in pages with their ids, sources, zones and stages', async () => {
    const lib = fakeLibrary({
      readRecords: jest
        .fn()
        .mockResolvedValueOnce({
          pageToken: 'next',
          records: [{ recordType: 'SleepSession', startTime: '2026-10-19T15:00:00Z', endTime: '2026-10-19T22:30:00Z', endZoneOffset: { id: '+08:00', totalSeconds: 28800 }, metadata: { id: 'abc', dataOrigin: 'com.watch.app' }, stages: [{ startTime: '2026-10-19T15:00:00Z', endTime: '2026-10-19T16:00:00Z', stage: 1 }] }],
        })
        .mockResolvedValueOnce({ records: [{ recordType: 'SleepSession', startTime: '2026-10-18T15:00:00Z', endTime: '2026-10-18T22:00:00Z' }] }),
    });

    const sessions = await adapterFor(lib).readSleep(window);

    expect(lib.readRecords).toHaveBeenCalledTimes(2);
    expect(lib.readRecords.mock.calls[0]).toEqual(['SleepSession', { timeRangeFilter: { operator: 'between', startTime: window.starts[0], endTime: window.end }, ascendingOrder: true, pageSize: 500 }]);
    expect(lib.readRecords.mock.calls[1][1]).toMatchObject({ pageToken: 'next' });
    expect(sessions[0]).toEqual({ id: 'abc', origin: 'com.watch.app', start: '2026-10-19T15:00:00Z', end: '2026-10-19T22:30:00Z', endOffsetMinutes: 480, stages: [{ start: '2026-10-19T15:00:00Z', end: '2026-10-19T16:00:00Z', type: 1 }] });
    expect(sessions[1]).toMatchObject({ id: null, origin: null, endOffsetMinutes: null, stages: null });
  });

  it('stops after a bounded number of pages', async () => {
    const lib = fakeLibrary({ readRecords: jest.fn().mockResolvedValue({ pageToken: 'again', records: [] }) });

    await adapterFor(lib).readSleep(window);

    expect(lib.readRecords.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('passes native errors up so the sync can record a failed read', async () => {
    const lib = fakeLibrary({ readRecords: jest.fn().mockRejectedValue(new Error('SecurityException')) });

    await expect(adapterFor(lib).readSleep(window)).rejects.toThrow('SecurityException');
  });
});

describe('what the adapter never does', () => {
  it('never writes or deletes Health Connect data, and never asks for anything beyond steps and sleep', async () => {
    const lib = fakeLibrary();
    const adapter = adapterFor(lib);

    await adapter.availability();
    await adapter.request();
    await adapter.granted();
    await adapter.readSteps(window).catch(() => undefined);
    await adapter.readSleep(window);
    await adapter.revoke();
    adapter.openSettings();

    expect(lib.insertRecords).not.toHaveBeenCalled();
    expect(lib.deleteRecordsByUuids).not.toHaveBeenCalled();
    expect(lib.deleteRecordsByTimeRange).not.toHaveBeenCalled();
    expect(JSON.stringify(lib.requestPermission.mock.calls)).not.toMatch(/write|Calories|HeartRate|Weight|Exercise|Background|History/i);
  });

  it('revokes through Health Connect and opens its settings', async () => {
    const lib = fakeLibrary();
    const adapter = adapterFor(lib);

    await adapter.revoke();
    adapter.openSettings();

    expect(lib.revokeAllPermissions).toHaveBeenCalled();
    expect(lib.openHealthConnectSettings).toHaveBeenCalled();
  });
});
