import { supabase } from '../lib/supabase';
import { listPending } from '../sync/queue';
import type { LocalDate } from '../sync/types';

// Every date the user has checked in: synced rows plus entries still waiting to sync, so the
// streak is right offline and an unsynced check-in counts once.
export async function loadCheckinDates(userId: string): Promise<LocalDate[]> {
  const dates = new Set<LocalDate>();
  try {
    const { data, error } = await supabase.from('checkins').select('checkin_date').eq('user_id', userId);
    if (!error) for (const row of data ?? []) dates.add(row.checkin_date);
  } catch {
    // Offline: pending entries below still count.
  }
  for (const op of await listPending(userId)) {
    if (op.kind === 'checkin') dates.add(op.date);
  }
  return [...dates];
}
