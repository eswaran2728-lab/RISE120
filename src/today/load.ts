import { readCache, writeCache } from '../cache/userCache';
import { supabase } from '../lib/supabase';
import { listPending } from '../sync/queue';
import type { LocalDate } from '../sync/types';

// Every date the user has checked in: synced rows plus entries still waiting to sync, so the
// streak is right offline and an unsynced check-in counts once. The last synced dates are
// remembered per account, so starting the app offline does not reset the streak.
export async function loadCheckinDates(userId: string): Promise<LocalDate[]> {
  const dates = new Set<LocalDate>();
  let synced: LocalDate[] | null = null;
  try {
    const { data, error } = await supabase.from('checkins').select('checkin_date').eq('user_id', userId);
    if (!error) {
      synced = (data ?? []).map((row) => row.checkin_date as LocalDate);
      await writeCache(userId, 'checkins', synced);
    }
  } catch {
    // Offline: fall back to the remembered dates below.
  }
  for (const date of synced ?? (await readCache<LocalDate[]>(userId, 'checkins')) ?? []) dates.add(date);
  for (const op of await listPending(userId)) {
    if (op.kind === 'checkin') dates.add(op.date);
  }
  return [...dates];
}

// Every date the user has logged at least one workout set: synced rows plus sets still waiting to sync.
export async function loadWorkoutDates(userId: string): Promise<LocalDate[]> {
  const dates = new Set<LocalDate>();
  try {
    const { data, error } = await supabase.from('workout_logs').select('log_date').eq('user_id', userId);
    if (!error) for (const row of data ?? []) dates.add(row.log_date as LocalDate);
  } catch {
    // Offline: only what is waiting to sync is known.
  }
  for (const op of await listPending(userId)) {
    if (op.kind === 'workout_set') dates.add(op.date);
  }
  return [...dates];
}
