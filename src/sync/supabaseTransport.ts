import { supabase } from '../lib/supabase';
import { quotaErrorFrom } from '../monetization/errors';
import { localPhotoExists, removeLocalPhoto, uploadCheckinPhoto } from '../checkin/photos';
import { clearPhotoUri } from './queue';
import { applyFoodLogToDayCache } from '../food/dayCache';
import type { CheckinOperation, FoodLogOperation, SyncTransport, WorkoutSetOperation } from './types';

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
        ...(op.sessionId ? { session_id: op.sessionId } : {}),
      },
      { onConflict: 'id' }
    );
    if (error) throw new Error(error.message);
  },

  async upsertFoodLog(userId: string, op: FoodLogOperation): Promise<void> {
    await assertSignedInAs(userId);
    const { error } = await supabase.from('food_logs').upsert(
      {
        id: op.id,
        user_id: userId,
        log_date: op.date,
        food_id: op.foodId,
        quantity: op.quantity,
        meal_type: op.mealType,
      },
      { onConflict: 'id' }
    );
    if (error) throw quotaErrorFrom(error) ?? new Error(error.message);
    await applyFoodLogToDayCache(userId, op);
  },

  // Deleting a row that is already gone is not an error, so a replayed delete is safe.
  async deleteFoodLog(userId: string, op: FoodLogOperation): Promise<void> {
    await assertSignedInAs(userId);
    const { error } = await supabase.from('food_logs').delete().eq('id', op.id).eq('user_id', userId);
    if (error) throw new Error(error.message);
    await applyFoodLogToDayCache(userId, op);
  },

  async upsertCheckin(userId: string, op: CheckinOperation): Promise<void> {
    await assertSignedInAs(userId);
    // Upload first: if it fails the whole check-in stays queued with its local photo.
    // If the local file is already gone, an earlier flush uploaded it (see below).
    const hasLocalPhoto = !!op.photoUri && localPhotoExists(op.photoUri);
    const photoPath = hasLocalPhoto ? await uploadCheckinPhoto(userId, op.date, op.photoUri as string) : undefined;
    const { error } = await supabase.from('checkins').upsert(
      {
        user_id: userId,
        checkin_date: op.date,
        weight_kg: op.weightKg,
        mood: op.mood,
        sleep_hours: op.sleepHours,
        // Left out when there is no new photo, so an existing photo_path is kept.
        ...(photoPath ? { photo_path: photoPath } : {}),
      },
      { onConflict: 'user_id,checkin_date' }
    );
    if (error) throw new Error(error.message);
    if (hasLocalPhoto) {
      try {
        await clearPhotoUri(userId, op.date, op.photoUri as string);
        removeLocalPhoto(op.photoUri as string);
      } catch {
        // Best effort: the photo is already safely uploaded.
      }
    }
  },
};
