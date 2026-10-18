// Brings the scheduled reminders in line with one account's saved preferences and today's progress. Safe to call
// as often as needed: it rebuilds the same window each time. Signed out (null) or a different account than the one
// the notifications were built for: the old window is replaced or removed, never kept.
import { dateInZone } from '../journey/dates';
import type { LocalDate } from '../sync/types';
import { cancelReminders, syncReminders, type NotificationApi, type ReminderText, type SyncResult } from './adapter';
import { loadReminders } from './preferences';

export interface ResyncOptions {
  api: NotificationApi;
  now: () => Date;
  timeZone: string; // the device's current time zone
  text: ReminderText;
  isWorkoutComplete: (userId: string, date: LocalDate) => Promise<boolean>;
}

export async function resyncReminders(userId: string | null, options: ResyncOptions): Promise<SyncResult> {
  const { api, now, timeZone, text } = options;
  if (!userId) {
    await cancelReminders(api);
    return 'off';
  }
  const prefs = await loadReminders(userId);
  if (!prefs.enabled) {
    await cancelReminders(api); // may hold the previous account's window
    return 'off';
  }
  const moment = now();
  let completed = false;
  try {
    completed = await options.isWorkoutComplete(userId, dateInZone(moment, timeZone));
  } catch {
    completed = false;
  }
  return syncReminders(api, prefs, completed, moment, timeZone, text);
}
