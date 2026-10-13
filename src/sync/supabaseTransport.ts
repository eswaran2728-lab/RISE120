import { supabase } from '../lib/supabase';
import type { CheckinOperation, SyncTransport, WorkoutSetOperation } from './types';

// Belt and braces: the queue is already per user, and row-level security rejects a foreign
// user_id, but never even attempt to send A's data while B is signed in.
async function assertSignedInAs(userId: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user?.id !== userId) throw new Error('Signed-in account changed');
}

export const supabaseTransport: SyncTransport = {
  async upsertWorkoutSet(userId: string, op: WorkoutSetOperation): Promise<void> {
    await assertSignedInAs(userId);
    const { error } = await supabase.from('workout_logs').upsert(
      {
        id: op.id,
        user_id: userId,
        log_date: op.date,
        exercise_id: op.exerciseId,
        set_number: op.setNumber,
        reps: op.reps,
        weight_kg: op.weightKg,
      },
      { onConflict: 'id' }
    );
    if (error) throw new Error(error.message);
  },

  async upsertCheckin(userId: string, op: CheckinOperation): Promise<void> {
    await assertSignedInAs(userId);
    const { error } = await supabase.from('checkins').upsert(
      {
        user_id: userId,
        checkin_date: op.date,
        weight_kg: op.weightKg,
        mood: op.mood,
        sleep_hours: op.sleepHours,
      },
      { onConflict: 'user_id,checkin_date' }
    );
    if (error) throw new Error(error.message);
  },
};
