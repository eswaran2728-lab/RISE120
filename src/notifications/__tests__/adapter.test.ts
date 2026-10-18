import { cancelReminders, enableReminders, syncReminders, REMINDER_ID, type NotificationApi } from '../adapter';
import { DEFAULT_REMINDERS } from '../preferences';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

const KL = 'Asia/Kuala_Lumpur';
const NOW = new Date('2026-10-18T01:00:00Z'); // 09:00 local
const on = { ...DEFAULT_REMINDERS, enabled: true, time: '18:00' };

function fakeApi(permission: 'granted' | 'denied' | 'undetermined' = 'granted') {
  let current = permission;
  const scheduled = new Map<string, { at: Date; title: string; body: string }>();
  const api: NotificationApi & { scheduled: typeof scheduled; asked: number } = {
    scheduled,
    asked: 0,
    permission: jest.fn(async () => current),
    requestPermission: jest.fn(async () => {
      api.asked += 1;
      if (current === 'undetermined') current = 'granted';
      return current;
    }),
    schedule: jest.fn(async (id, at, title, body) => void scheduled.set(id, { at, title, body })),
    cancel: jest.fn(async (id) => void scheduled.delete(id)),
  };
  return api;
}
const text = { title: 'Rise120', body: 'Your plan is ready when you are.' };

describe('syncReminders', () => {
  it('schedules exactly one notification at the next reminder time', async () => {
    const api = fakeApi();

    expect(await syncReminders(api, on, false, NOW, KL, text)).toBe('scheduled');

    expect([...api.scheduled.keys()]).toEqual([REMINDER_ID]);
    expect(api.scheduled.get(REMINDER_ID)!.at).toEqual(new Date('2026-10-18T10:00:00Z'));
  });

  it('uses only the generic text it is given (nothing about the persons body or progress)', async () => {
    const api = fakeApi();
    await syncReminders(api, on, false, NOW, KL, text);

    expect(api.scheduled.get(REMINDER_ID)).toMatchObject(text);
  });

  it('replaces the earlier one when rescheduled, so a day never has two', async () => {
    const api = fakeApi();
    await syncReminders(api, on, false, NOW, KL, text);
    await syncReminders(api, { ...on, time: '19:30' }, false, NOW, KL, text);

    expect(api.scheduled.size).toBe(1);
    expect(api.scheduled.get(REMINDER_ID)!.at).toEqual(new Date('2026-10-18T11:30:00Z'));
  });

  it('schedules tomorrow once todays session is done', async () => {
    const api = fakeApi();
    await syncReminders(api, on, true, NOW, KL, text);

    expect(api.scheduled.get(REMINDER_ID)!.at).toEqual(new Date('2026-10-19T10:00:00Z'));
  });

  it('cancels and reports off when reminders are switched off or paused', async () => {
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

  it('cancels a scheduled reminder when permission has since been revoked', async () => {
    const api = fakeApi();
    await syncReminders(api, on, false, NOW, KL, text);
    (api.permission as jest.Mock).mockResolvedValue('denied');

    expect(await syncReminders(api, on, false, NOW, KL, text)).toBe('no_permission');
    expect(api.scheduled.size).toBe(0);
  });
});

describe('enableReminders', () => {
  it('asks for permission only when the person turns reminders on, then schedules', async () => {
    const api = fakeApi('undetermined');

    expect(await enableReminders(api, on, false, NOW, KL, text)).toBe('scheduled');
    expect(api.asked).toBe(1);
  });

  it('does not schedule when the person says no', async () => {
    const api = fakeApi('denied');

    expect(await enableReminders(api, on, false, NOW, KL, text)).toBe('no_permission');
    expect(api.scheduled.size).toBe(0);
  });
});

describe('cancelReminders', () => {
  it('removes the personal reminder, for sign-out or account deletion', async () => {
    const api = fakeApi();
    await syncReminders(api, on, false, NOW, KL, text);
    await cancelReminders(api);

    expect(api.scheduled.size).toBe(0);
  });
});
