// The real device binding for NotificationApi (expo-notifications). It is NOT yet verified on a physical phone:
// unit tests cover the logic around it, not the operating system's delivery of the notifications.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { NotificationApi, PermissionState } from './adapter';

const CHANNEL = 'reminders';

const state = (status: Notifications.PermissionStatus): PermissionState => (status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined');

let channel: Promise<unknown> | null = null;
const ensureChannel = () => {
  if (Platform.OS !== 'android') return Promise.resolve();
  channel ??= Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Reminders', importance: Notifications.AndroidImportance.DEFAULT });
  return channel;
};

export const expoNotificationApi: NotificationApi = {
  async permission() {
    return state((await Notifications.getPermissionsAsync()).status);
  },
  async requestPermission() {
    return state((await Notifications.requestPermissionsAsync()).status);
  },
  async schedule(id, at, title, body) {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title, body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
    });
  },
  async cancel(id) {
    await Notifications.cancelScheduledNotificationAsync(id);
  },
  async scheduledIds() {
    return (await Notifications.getAllScheduledNotificationsAsync()).map((request) => request.identifier);
  },
};
