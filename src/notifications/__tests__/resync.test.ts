import { resyncReminders } from '../resync';
import { REMINDER_PREFIX, type NotificationApi, type PermissionState } from '../adapter';
import { DEFAULT_REMINDERS, saveReminders } from '../preferences';
import { mockStore } from '../../sync/testing/storageMock';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

const KL = 'Asia/Kuala_Lumpur';
const NOW = new Date('2026-10-18T01:00:00Z'); // 09:00 local, 2026-10-18
const text = { title: 'Rise120', body: 'Your plan is ready when you are.' };
const on = { ...DEFAULT_REMINDERS, enabled: true, time: '18:00' };

function fakeApi(permission: PermissionState = 'granted') {
  const scheduled = new Map<string, Date>();
  const api: NotificationApi & { scheduled: typeof scheduled } = {
    scheduled,
    permission: jest.fn(async () => permission),
    requestPermission: jest.fn(async () => permission),
    schedule: jest.fn(async (id, at) => void scheduled.set(id, at)),
    cancel: jest.fn(async (id) => void scheduled.delete(id)),
    scheduledIds: jest.fn(async () => [...scheduled.keys()]),
  };
  return api;
}
const firstDay = (api: ReturnType<typeof fakeApi>) => [...api.scheduled.values()].map((d) => d.toISOString()).sort()[0];
const options = (api: NotificationApi, over: Partial<Parameters<typeof resyncReminders>[1]> = {}) => ({ api, now: () => NOW, timeZone: KL, text, isWorkoutComplete: jest.fn(async () => false), ...over });

beforeEach(() => mockStore.clear());

describe('resyncReminders', () => {
  it('schedules nothing for an account that never turned reminders on', async () => {
    const api = fakeApi();

    expect(await resyncReminders('A', options(api))).toBe('off');
    expect(api.scheduled.size).toBe(0);
  });

  it('schedules the window from the accounts own saved preferences', async () => {
    await saveReminders('A', on);
    const api = fakeApi();

    expect(await resyncReminders('A', options(api))).toBe('scheduled');
    expect(api.scheduled.size).toBe(14);
  });

  it('skips today when the workout for today is complete, and asks about the local date in the device zone', async () => {
    await saveReminders('A', on);
    const api = fakeApi();
    const isWorkoutComplete = jest.fn(async () => true);

    await resyncReminders('A', options(api, { isWorkoutComplete }));

    expect(isWorkoutComplete).toHaveBeenCalledWith('A', '2026-10-18');
    expect(firstDay(api)).toBe('2026-10-19T10:00:00.000Z');
  });

  it('keeps todays reminder when only part of the workout is done', async () => {
    await saveReminders('A', on);
    const api = fakeApi();

    await resyncReminders('A', options(api, { isWorkoutComplete: jest.fn(async () => false) }));

    expect(firstDay(api)).toBe('2026-10-18T10:00:00.000Z');
  });

  it('uses the local date of the device zone, not UTC (a late evening in Kuala Lumpur is still the same UTC day)', async () => {
    await saveReminders('A', on);
    const api = fakeApi();
    const isWorkoutComplete = jest.fn(async () => false);

    await resyncReminders('A', options(api, { now: () => new Date('2026-10-18T16:30:00Z'), isWorkoutComplete })); // 00:30 on the 19th locally

    expect(isWorkoutComplete).toHaveBeenCalledWith('A', '2026-10-19');
  });

  it('still schedules from saved preferences when completion cannot be read (offline launch)', async () => {
    await saveReminders('A', on);
    const api = fakeApi();

    expect(await resyncReminders('A', options(api, { isWorkoutComplete: jest.fn(async () => Promise.reject(new Error('offline'))) }))).toBe('scheduled');
    expect(firstDay(api)).toBe('2026-10-18T10:00:00.000Z');
  });

  it('cancels everything when permission has been revoked', async () => {
    await saveReminders('A', on);
    const api = fakeApi();
    await resyncReminders('A', options(api));

    const revoked = fakeApi('denied');
    api.scheduled.forEach((at, id) => revoked.scheduled.set(id, at));
    expect(await resyncReminders('A', options(revoked))).toBe('no_permission');
    expect(revoked.scheduled.size).toBe(0);
  });

  it('removes the previous accounts reminders when another account signs in, even one with reminders off', async () => {
    await saveReminders('A', on);
    const api = fakeApi();
    await resyncReminders('A', options(api));
    expect(api.scheduled.size).toBe(14);

    expect(await resyncReminders('B', options(api))).toBe('off');
    expect(api.scheduled.size).toBe(0);
  });

  it('replaces the previous accounts reminders with the new accounts own times', async () => {
    await saveReminders('A', on);
    await saveReminders('B', { ...on, time: '06:30' });
    const api = fakeApi();
    await resyncReminders('A', options(api));
    await resyncReminders('B', options(api));

    expect(api.scheduled.size).toBe(14);
    expect(firstDay(api)).toBe('2026-10-18T22:30:00.000Z'); // B: 06:30 tomorrow
    [...api.scheduled.keys()].forEach((id) => expect(id.startsWith(REMINDER_PREFIX)).toBe(true));
  });

  it('cancels everything when nobody is signed in', async () => {
    await saveReminders('A', on);
    const api = fakeApi();
    await resyncReminders('A', options(api));

    expect(await resyncReminders(null, options(api))).toBe('off');
    expect(api.scheduled.size).toBe(0);
  });

  it('twice in a row leaves one window, not two', async () => {
    await saveReminders('A', on);
    const api = fakeApi();
    await Promise.all([resyncReminders('A', options(api)), resyncReminders('A', options(api))]);

    expect(api.scheduled.size).toBe(14);
  });
});
