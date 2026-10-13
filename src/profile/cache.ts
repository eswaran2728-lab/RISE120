import { readCache, writeCache } from '../cache/userCache';
import { supabase } from '../lib/supabase';

export type Units = 'metric' | 'imperial';

// What the app needs to start with no signal: routing flags and language. Units are remembered
// separately (see cacheUnits) because screens need them without a full profile read.
export interface ProfileCache {
  onboarded: boolean;
  needsPlanInputs: boolean;
  language: string | null;
}

export const loadProfileCache = (userId: string) => readCache<ProfileCache>(userId, 'profile');

export const saveProfileCache = (userId: string, profile: ProfileCache) => writeCache(userId, 'profile', profile);

export async function updateProfileCache(userId: string, patch: Partial<ProfileCache>): Promise<void> {
  const current = await loadProfileCache(userId);
  if (current) await saveProfileCache(userId, { ...current, ...patch });
}

export const cacheUnits = (userId: string, units: Units) => writeCache(userId, 'units', units);

// The user's units. Offline we use the last known value, so an imperial user is never shown
// "kg" and silently stores pounds as kilograms.
export async function loadUnits(userId: string): Promise<Units> {
  try {
    const { data, error } = await supabase.from('profiles').select('units').eq('id', userId).maybeSingle();
    if (!error && data?.units) {
      const units: Units = data.units === 'imperial' ? 'imperial' : 'metric';
      await cacheUnits(userId, units);
      return units;
    }
  } catch {
    // Offline: fall through to the remembered value.
  }
  return (await readCache<Units>(userId, 'units')) ?? 'metric';
}
