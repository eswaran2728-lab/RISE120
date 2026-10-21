import AsyncStorage from '@react-native-async-storage/async-storage';
import { EMPTY_HEALTH_STATE, HealthState, ImportedDay } from './types';

// The imported copies live on the phone, per account, under the same key shape as the other per-account caches so that
// deleting an account clears them (see clearUserCache). They are never sent to the server and never merged into anything
// the member typed.
const keyFor = (userId: string) => `rise120.cache.${userId}.health`;

const isDay = (value: unknown): value is ImportedDay => {
  const d = value as ImportedDay;
  return !!d && typeof d.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.day) && typeof d.value === 'number' && Number.isFinite(d.value) && d.value >= 0 && Array.isArray(d.origins) && typeof d.revision === 'string';
};

function days(value: unknown): Record<string, ImportedDay> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, ImportedDay> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) if (isDay(entry) && entry.day === key) out[key] = { ...entry, origins: entry.origins.filter((o) => typeof o === 'string') };
  return out;
}

// A stored copy that cannot be read is treated as "not connected", never as a crash.
export async function loadHealth(userId: string): Promise<HealthState> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return { ...EMPTY_HEALTH_STATE, steps: {}, sleep: {} };
    const parsed = JSON.parse(raw) as Partial<HealthState>;
    if (parsed.version !== 1 || (parsed.status !== 'connected' && parsed.status !== 'disconnected')) return { ...EMPTY_HEALTH_STATE, steps: {}, sleep: {} };
    return {
      version: 1,
      status: parsed.status,
      permissions: { steps: parsed.permissions?.steps === true, sleep: parsed.permissions?.sleep === true },
      connectedAt: typeof parsed.connectedAt === 'string' ? parsed.connectedAt : null,
      lastSyncAt: typeof parsed.lastSyncAt === 'string' ? parsed.lastSyncAt : null,
      lastSyncResult: parsed.lastSyncResult === 'ok' || parsed.lastSyncResult === 'partial' || parsed.lastSyncResult === 'failed' ? parsed.lastSyncResult : null,
      steps: days(parsed.steps),
      sleep: days(parsed.sleep),
    };
  } catch {
    return { ...EMPTY_HEALTH_STATE, steps: {}, sleep: {} };
  }
}

// Unlike the convenience caches this throws when it cannot write: a sync that could not save has not succeeded.
export async function saveHealth(userId: string, state: HealthState): Promise<void> {
  await AsyncStorage.setItem(keyFor(userId), JSON.stringify(state));
}

export async function removeHealth(userId: string): Promise<void> {
  await AsyncStorage.removeItem(keyFor(userId));
}
