// The real inputs for reminder syncing: the device notification API, the clock, the device's current time zone and
// the app's own plan data. Everything that needs "sync reminders now" calls these.
import { t } from '../i18n';
import { cancelReminders } from './adapter';
import { workoutCompleteToday } from './completion';
import { expoNotificationApi } from './expoApi';
import { resyncReminders } from './resync';

export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export async function syncRemindersNow(userId: string | null): Promise<void> {
  await resyncReminders(userId, {
    api: expoNotificationApi,
    now: () => new Date(),
    timeZone: deviceTimeZone(),
    text: { title: t('reminders.title'), body: t('reminders.body') },
    isWorkoutComplete: workoutCompleteToday,
  });
}

export const cancelRemindersNow = () => cancelReminders(expoNotificationApi);
