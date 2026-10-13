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
}

export interface CheckinOperation extends OperationBase {
  kind: 'checkin';
  date: LocalDate; // unique per user and date on the server
  weightKg: number | null;
  mood: number | null;
  sleepHours: number | null;
  photoUri: string | null; // local file until the upload succeeds (Task 6)
}

export type PendingOperation = WorkoutSetOperation | CheckinOperation;

export interface SyncTransport {
  upsertWorkoutSet(userId: string, op: WorkoutSetOperation): Promise<void>;
  upsertCheckin(userId: string, op: CheckinOperation): Promise<void>;
}

export interface SyncResult {
  synced: number;
  failed: number;
  remaining: number;
}
