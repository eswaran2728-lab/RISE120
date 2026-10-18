// The real device binding for NotificationApi. Verified on a phone, not in unit tests.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { NotificationApi, PermissionState } from './adapter';

const CHANNEL = 'reminders';

const state = (status: Notifications.PermissionStatus): PermissionState => (status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined');

export const expoNotificationApi: NotificationApi = {
  async permission() {
    return state((await Notifications.getPermissionsAsync()).status);
  },
  async requestPermission() {
    return state((await Notifications.requestPermissionsAsync()).status);
  },
  async schedule(id, at, title, body) {
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Reminders', importance: Notifications.AndroidImportance.DEFAULT });
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title, body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
    });
  },
  async cancel(id) {
    await Notifications.cancelScheduledNotificationAsync(id);
  },
};
