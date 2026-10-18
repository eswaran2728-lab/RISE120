// Turns the pure schedule into at most one local notification. The device is behind NotificationApi so this logic
// is testable; expoApi.ts is the real binding. One fixed id means a reschedule replaces, never adds.
import { nextReminder, type ReminderPreferences } from './schedule';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface NotificationApi {
  permission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  schedule(id: string, at: Date, title: string, body: string): Promise<void>;
  cancel(id: string): Promise<void>;
}

export const REMINDER_ID = 'rise120-personal-reminder';

export interface ReminderText {
  title: string;
  body: string; // generic: it appears on the lock screen
}

export type SyncResult = 'scheduled' | 'off' | 'no_permission';

// Brings the one scheduled reminder in line with the preferences. Never asks for permission by itself.
export async function syncReminders(api: NotificationApi, prefs: ReminderPreferences, completedToday: boolean, now: Date, timeZone: string, text: ReminderText): Promise<SyncResult> {
  const at = nextReminder(prefs, completedToday, now, timeZone);
  if (!at) {
    await api.cancel(REMINDER_ID);
    return 'off';
  }
  if ((await api.permission()) !== 'granted') {
    await api.cancel(REMINDER_ID);
    return 'no_permission';
  }
  await api.cancel(REMINDER_ID);
  await api.schedule(REMINDER_ID, at, text.title, text.body);
  return 'scheduled';
}

// The moment the person turns reminders on: the only place permission is requested.
export async function enableReminders(api: NotificationApi, prefs: ReminderPreferences, completedToday: boolean, now: Date, timeZone: string, text: ReminderText): Promise<SyncResult> {
  if ((await api.permission()) === 'undetermined') await api.requestPermission();
  return syncReminders(api, prefs, completedToday, now, timeZone, text);
}

export const cancelReminders = (api: NotificationApi) => api.cancel(REMINDER_ID);
