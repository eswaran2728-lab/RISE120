import { supabase } from '../lib/supabase';
import { listPending } from '../sync/queue';
import type { LocalDate } from '../sync/types';

export interface LoadedCheckin {
  weightKg: number | null;
  mood: number | null;
  sleepHours: number | null;
  photoPath?: string | null;
  photoUri?: string | null;
  pending: boolean;
}

// The check-in to show for a date: the not-yet-synced local edit if there is one (it is newer),
// otherwise the server row. Offline, the pending edit alone is enough.
export async function loadCheckin(userId: string, date: LocalDate): Promise<LoadedCheckin | null> {
  const pending = (await listPending(userId)).find((op) => op.kind === 'checkin' && op.date === date);
  if (pending && pending.kind === 'checkin') {
    return {
      weightKg: pending.weightKg,
      mood: pending.mood,
      sleepHours: pending.sleepHours,
      photoUri: pending.photoUri,
      pending: true,
    };
  }

  try {
    const { data, error } = await supabase
      .from('checkins')
      .select('weight_kg, mood, sleep_hours, photo_path')
      .eq('user_id', userId)
      .eq('checkin_date', date)
      .maybeSingle();
    if (error || !data) return null;
    return {
      weightKg: data.weight_kg === null ? null : Number(data.weight_kg),
      mood: data.mood,
      sleepHours: data.sleep_hours === null ? null : Number(data.sleep_hours),
      photoPath: data.photo_path,
      pending: false,
    };
  } catch {
    return null;
  }
}
