import { cancelReminders, enableReminders, REMINDER_HORIZON_DAYS, REMINDER_PREFIX, syncReminders, type NotificationApi, type PermissionState } from '../adapter';
import { DEFAULT_REMINDERS } from '../preferences';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

const KL = 'Asia/Kuala_Lumpur';
const NOW = new Date('2026-10-18T01:00:00Z'); // 09:00 local
const on = { ...DEFAULT_REMINDERS, enabled: true, time: '18:00' };
const text = { title: 'Rise120', body: 'Your plan is ready when you are.' };

function fakeApi(permission: PermissionState = 'granted') {
  let current = permission;
  const scheduled = new Map<string, { at: Date; title: string; body: string }>();
  const api: NotificationApi & { scheduled: typeof scheduled; asked: number; setPermission: (p: PermissionState) => void } = {
    scheduled,
    asked: 0,
    setPermission: (p) => void (current = p),
    permission: jest.fn(async () => current),
    requestPermission: jest.fn(async () => {
      api.asked += 1;
      if (current === 'undetermined') current = 'granted';
      return current;
    }),
    schedule: jest.fn(async (id, at, title, body) => {
      await Promise.resolve(); // a real device call yields, which is where interleaving could happen
      scheduled.set(id, { at, title, body });
    }),
    cancel: jest.fn(async (id) => {
      await Promise.resolve();
      scheduled.delete(id);
    }),
    scheduledIds: jest.fn(async () => [...scheduled.keys()]),
  };
  return api;
}
const times = (api: ReturnType<typeof fakeApi>) => [...api.scheduled.values()].map((v) => v.at.toISOString()).sort();

describe('syncReminders', () => {
  it('schedules one notification per day for the whole horizon, so reminders continue without opening Settings', async () => {
    const api = fakeApi();

    expect(await syncReminders(api, on, false, NOW, KL, text)).toBe('scheduled');

    expect(REMINDER_HORIZON_DAYS).toBe(14);
    expect(api.scheduled.size).toBe(REMINDER_HORIZON_DAYS);
    const days = times(api);
    expect(days[0]).toBe('2026-10-18T10:00:00.000Z');
    expect(days[13]).toBe('2026-10-31T10:00:00.000Z');
    [...api.scheduled.keys()].forEach((id) => expect(id.startsWith(REMINDER_PREFIX)).toBe(true));
  });

  it('replenishes the horizon when the app runs on a later day', async () => {
    const api = fakeApi();
    await syncReminders(api, on, false, NOW, KL, text);

    await syncReminders(api, on, false, new Date('2026-10-25T01:00:00Z'), KL, text);

    expect(api.scheduled.size).toBe(14);
    expect(times(api)[0]).toBe('2026-10-25T10:00:00.000Z');
    expect(times(api)[13]).toBe('2026-11-07T10:00:00.000Z');
  });

  it('uses only the generic text it is given', async () => {
    const api = fakeApi();
    await syncReminders(api, on, false, NOW, KL, text);

    [...api.scheduled.values()].forEach((v) => expect(v).toMatchObject(text));
  });

  it('never makes duplicates, however often it resyncs', async () => {
    const api = fakeApi();
    for (let i = 0; i < 4; i++) await syncReminders(api, on, false, NOW, KL, text);

    expect(api.scheduled.size).toBe(14);
  });

  it('never makes duplicates when two resyncs overlap (launch and foreground together)', async () => {
    const api = fakeApi();
    await Promise.all([syncReminders(api, on, false, NOW, KL, text), syncReminders(api, on, false, NOW, KL, text), syncReminders(api, { ...on, time: '19:30' }, false, NOW, KL, text)]);

    expect(api.scheduled.size).toBe(14);
    expect(times(api)[0]).toBe('2026-10-18T11:30:00.000Z'); // the last call wins
  });

  it('removes only the reminder for today once the workout for today is complete', async () => {
    const api = fakeApi();
    await syncReminders(api, on, false, NOW, KL, text);

    await syncReminders(api, on, true, NOW, KL, text);

    expect(api.scheduled.size).toBe(14);
    expect(times(api)[0]).toBe('2026-10-19T10:00:00.000Z');
  });

  it('puts the reminder for today back if completion does not hold', async () => {
    const api = fakeApi();
    await syncReminders(api, on, true, NOW, KL, text);
    await syncReminders(api, on, false, NOW, KL, text);

    expect(times(api)[0]).toBe('2026-10-18T10:00:00.000Z');
  });

  it('cancels everything and reports off when reminders are switched off', async () => {
    const api = fakeApi();
    await syncReminders(api, on, false, NOW, KL, text);

    expect(await syncReminders(api, { ...on, enabled: false }, false, NOW, KL, text)).toBe('off');
    expect(api.scheduled.size).toBe(0);
  });

  it('schedules nothing and never asks again when permission was denied', async () => {
    const api = fakeApi('denied');

    expect(await syncReminders(api, on, false, NOW, KL, text)).toBe('no_permission');
    expect(api.scheduled.size).toBe(0);
    expect(api.requestPermission).not.toHaveBeenCalled();
  });

  it('cancels every scheduled reminder when permission has since been revoked', async () => {
    const api = fakeApi();
    await syncReminders(api, on, false, NOW, KL, text);
    api.setPermission('denied');

    expect(await syncReminders(api, on, false, NOW, KL, text)).toBe('no_permission');
    expect(api.scheduled.size).toBe(0);
  });

  it('follows the device time zone it is given, so the same clock time lands on a different instant', async () => {
    const api = fakeApi();
    await syncReminders(api, on, false, NOW, 'Europe/London', text);

    expect(times(api)[0]).toBe('2026-10-18T17:00:00.000Z');
  });

  it('keeps 08:00 local across the daylight-saving change', async () => {
    const api = fakeApi();
    await syncReminders(api, { ...on, time: '08:00' }, false, new Date('2026-03-07T20:00:00Z'), 'America/New_York', text);

    const days = times(api);
    expect(days[0]).toBe('2026-03-08T12:00:00.000Z');
    expect(days[1]).toBe('2026-03-09T12:00:00.000Z');
  });

  it('leaves notifications that are not its own alone', async () => {
    const api = fakeApi();
    api.scheduled.set('someone-else', { at: NOW, title: 'x', body: 'y' });
    await syncReminders(api, on, false, NOW, KL, text);
    await cancelReminders(api);

    expect([...api.scheduled.keys()]).toEqual(['someone-else']);
  });
});

describe('enableReminders', () => {
  it('asks for permission only when the person turns reminders on, then schedules', async () => {
    const api = fakeApi('undetermined');

    expect(await enableReminders(api, on, false, NOW, KL, text)).toBe('scheduled');
    expect(api.asked).toBe(1);
    expect(api.scheduled.size).toBe(14);
  });

  it('does not schedule when the person says no', async () => {
    const api = fakeApi('denied');

    expect(await enableReminders(api, on, false, NOW, KL, text)).toBe('no_permission');
    expect(api.scheduled.size).toBe(0);
  });
});

describe('cancelReminders', () => {
  it('removes every personal reminder, for sign-out, account switch or deletion', async () => {
    const api = fakeApi();
    await syncReminders(api, on, false, NOW, KL, text);
    await cancelReminders(api);

    expect(api.scheduled.size).toBe(0);
  });

  it('removes a reminder left by the earlier single-notification version', async () => {
    const api = fakeApi();
    api.scheduled.set('rise120-personal-reminder', { at: NOW, title: 'x', body: 'y' });
    await cancelReminders(api);

    expect(api.scheduled.size).toBe(0);
  });
});
