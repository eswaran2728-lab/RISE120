import { supabase } from '../lib/supabase';
import { loadPlanBundle } from '../plan/planData';
import { listPending } from '../sync/queue';
import type { LocalDate } from '../sync/types';
import type { ProgressInput, ServerCheckin } from './selectors';

// Everything the Progress screen needs. Reads run under row-level security (own rows only).
// If the server rows cannot be read (offline), the plan and pending local entries still show.
export async function loadProgress(userId: string, today: LocalDate): Promise<ProgressInput | null> {
  const bundle = await loadPlanBundle(userId);
  if (!bundle) return null;

  let workoutLogs: ProgressInput['workoutLogs'] = [];
  let checkins: ServerCheckin[] = [];
  try {
    const [logs, rows] = await Promise.all([
      supabase.from('workout_logs').select('id, log_date').eq('user_id', userId),
      supabase.from('checkins').select('checkin_date, weight_kg, mood, sleep_hours, photo_path').eq('user_id', userId),
    ]);
    if (!logs.error) workoutLogs = (logs.data ?? []).map((row) => ({ id: row.id, date: row.log_date }));
    if (!rows.error) {
      checkins = (rows.data ?? []).map((row) => ({
        date: row.checkin_date,
        weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
        mood: row.mood,
        sleepHours: row.sleep_hours === null ? null : Number(row.sleep_hours),
        photoPath: row.photo_path,
      }));
    }
  } catch {
    // Offline: fall through with what we have.
  }

  return {
    userId,
    plan: bundle.plan,
    days: bundle.days,
    today,
    workoutLogs,
    checkins,
    pending: await listPending(userId),
  };
}
