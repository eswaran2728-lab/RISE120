// Turns the pure schedule into a rolling window of local notifications. The device is behind NotificationApi so
// this logic is testable; expoApi.ts is the real binding.
//
// Why a window and not one repeating notification: a repeating trigger cannot skip a day on which the workout is
// already done, cannot move into quiet hours, and cannot be told apart from another account's. So the app
// schedules one dated notification per day for the next REMINDER_HORIZON_DAYS days and rebuilds the whole window
// every time it runs (launch, return to the foreground, a settings change, a workout completed, an account
// change). If the app is not opened for longer than the horizon, reminders stop after the last scheduled day.
import { reminderDates, type ReminderPreferences } from './schedule';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface NotificationApi {
  permission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  schedule(id: string, at: Date, title: string, body: string): Promise<void>;
  cancel(id: string): Promise<void>;
  scheduledIds(): Promise<string[]>;
}

export const REMINDER_PREFIX = 'rise120-reminder-';
const LEGACY_REMINDER_ID = 'rise120-personal-reminder'; // the earlier one-notification version
export const REMINDER_HORIZON_DAYS = 14;

export interface ReminderText {
  title: string;
  body: string; // generic: it appears on the lock screen
}

export type SyncResult = 'scheduled' | 'off' | 'no_permission';

// Calls on one device run one after another. Launch and foreground can fire together; without this their
// cancel-then-schedule steps could interleave and leave two notifications for one day.
const queues = new WeakMap<NotificationApi, Promise<unknown>>();
function serial<T>(api: NotificationApi, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(api) ?? Promise.resolve()).catch(() => undefined).then(task);
  queues.set(api, run.catch(() => undefined));
  return run;
}

async function clearAll(api: NotificationApi): Promise<void> {
  for (const id of await api.scheduledIds()) {
    if (id.startsWith(REMINDER_PREFIX) || id === LEGACY_REMINDER_ID) await api.cancel(id);
  }
}

// Rebuilds the whole window from the preferences. Never asks for permission by itself.
export function syncReminders(api: NotificationApi, prefs: ReminderPreferences, completedToday: boolean, now: Date, timeZone: string, text: ReminderText): Promise<SyncResult> {
  return serial(api, async () => {
    const dates = reminderDates(prefs, completedToday, now, timeZone, REMINDER_HORIZON_DAYS);
    if (dates.length === 0) {
      await clearAll(api);
      return 'off';
    }
    if ((await api.permission()) !== 'granted') {
      await clearAll(api);
      return 'no_permission';
    }
    await clearAll(api);
    for (const at of dates) await api.schedule(`${REMINDER_PREFIX}${at.toISOString()}`, at, text.title, text.body);
    return 'scheduled';
  });
}

// The moment the person turns reminders on: the only place permission is requested.
export async function enableReminders(api: NotificationApi, prefs: ReminderPreferences, completedToday: boolean, now: Date, timeZone: string, text: ReminderText): Promise<SyncResult> {
  if ((await api.permission()) === 'undetermined') await api.requestPermission();
  return syncReminders(api, prefs, completedToday, now, timeZone, text);
}

export const cancelReminders = (api: NotificationApi): Promise<void> => serial(api, () => clearAll(api));
