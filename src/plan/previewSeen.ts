import AsyncStorage from '@react-native-async-storage/async-storage';

const keyFor = (userId: string) => `rise120.planPreviewSeen.${userId}`;

export async function hasSeenPreview(userId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(keyFor(userId))) === '1';
}

export async function markPreviewSeen(userId: string): Promise<void> {
  await AsyncStorage.setItem(keyFor(userId), '1');
}
