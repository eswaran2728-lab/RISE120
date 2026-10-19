import type { Food, MealType } from '../food/types';
import type { PendingLimit } from '../monetization/errors';

export type LocalDate = string; // YYYY-MM-DD in the device's local calendar

interface OperationBase {
  // Local edit time; when two edits share a key, the latest wins.
  updatedAt: number;
}

export interface WorkoutSetOperation extends OperationBase {
  kind: 'workout_set';
  id: string; // client-generated UUID, used as workout_logs.id so a replay cannot duplicate
  date: LocalDate;
  exerciseId: string;
  setNumber: number;
  reps: number;
  weightKg: number;
  sessionId?: string; // the started session this set belongs to, when it was logged inside one
}

export interface CheckinOperation extends OperationBase {
  kind: 'checkin';
  date: LocalDate; // unique per user and date on the server
  weightKg: number | null;
  mood: number | null;
  sleepHours: number | null;
  photoUri: string | null; // local file until the upload succeeds (Task 6)
}

// A meal log. `deleted: true` is a tombstone: it stays queued until the server confirms the delete,
// so a delete made offline replays. `food` is a snapshot so the log can be shown before it syncs.
export interface FoodLogOperation extends OperationBase {
  kind: 'food_log';
  id: string; // client-generated UUID, used as food_logs.id so a replay cannot duplicate
  date: LocalDate;
  foodId: string;
  quantity: number; // number of listed servings
  mealType: MealType;
  deleted: boolean;
  food: Food | null;
  // Set when the server refused this log for the daily limit. The log stays queued under the same id and
  // is retried; the reason is only shown to the user and is dropped when the entry is edited or synced.
  blocked?: PendingLimit | null;
}

export type PendingOperation = WorkoutSetOperation | CheckinOperation | FoodLogOperation;

export interface SyncTransport {
  upsertWorkoutSet(userId: string, op: WorkoutSetOperation): Promise<void>;
  upsertCheckin(userId: string, op: CheckinOperation): Promise<void>;
  upsertFoodLog(userId: string, op: FoodLogOperation): Promise<void>;
  deleteFoodLog(userId: string, op: FoodLogOperation): Promise<void>;
}

export interface SyncResult {
  synced: number;
  failed: number;
  remaining: number;
}
