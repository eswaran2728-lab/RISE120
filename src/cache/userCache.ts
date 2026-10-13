import AsyncStorage from '@react-native-async-storage/async-storage';

// Small per-user cache of what the app last read from the server (plan, profile flags, today's
// synced sets), so the app still works at the gym with no signal. Never shared between accounts.
export type CacheName = 'plan' | 'profile' | 'units' | 'sets' | 'checkins' | 'recentFoods' | 'foodDay';
const NAMES: CacheName[] = ['plan', 'profile', 'units', 'sets', 'checkins', 'recentFoods', 'foodDay'];

const keyFor = (userId: string, name: CacheName) => `rise120.cache.${userId}.${name}`;

export async function readCache<T>(userId: string, name: CacheName): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId, name));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeCache(userId: string, name: CacheName, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId, name), JSON.stringify(value));
  } catch {
    // The cache is a convenience; failing to write it must never break the app.
  }
}

// Called when the account is deleted.
export async function clearUserCache(userId: string): Promise<void> {
  await Promise.all(NAMES.map((name) => AsyncStorage.removeItem(keyFor(userId, name))));
}
