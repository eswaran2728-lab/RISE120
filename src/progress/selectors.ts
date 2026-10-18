import { addLocalDays } from '../lib/dates';
import type { Plan, PlanDay } from '../plan/types';
import type { LocalDate, PendingOperation } from '../sync/types';

export const PLAN_LENGTH = 120;

export interface ServerCheckin {
  date: LocalDate;
  weightKg: number | null;
  mood: number | null;
  sleepHours: number | null;
  photoPath: string | null;
}

export interface ProgressInput {
  userId: string;
  plan: Plan;
  days: PlanDay[];
  today: LocalDate; // the device's local calendar date
  workoutLogs: { id: string; date: LocalDate; exerciseId?: string; reps?: number; weightKg?: number | null }[];
  exerciseNames?: Record<string, string>;
  checkins: ServerCheckin[];
  pending: PendingOperation[];
}

export interface WeightPoint {
  date: LocalDate;
  weightKg: number;
  pending: boolean;
}

export interface HistoryEntry {
  date: LocalDate;
  weightKg: number | null;
  mood: number | null;
  sleepHours: number | null;
  photoPath: string | null;
  pending: boolean;
}

export interface PhotoEntry {
  date: LocalDate;
  path: string | null; // private storage object path (read through a signed URL)
  localUri: string | null; // photo still waiting to upload
  pending: boolean;
}

export type CalendarState = 'complete' | 'partial' | 'missed' | 'upcoming';

export interface CalendarCell {
  dayNumber: number;
  date: LocalDate;
  state: CalendarState;
  isToday: boolean;
  pending: boolean;
}

export interface ProgressState {
  weightPoints: WeightPoint[];
  history: HistoryEntry[];
  photos: PhotoEntry[];
  calendar: CalendarCell[];
}

interface MergedCheckin extends HistoryEntry {
  localPhotoUri: string | null;
}

export function deriveProgress(input: ProgressInput): ProgressState {
  const ownPrefix = `${input.userId}/`;

  // One entry per date: the server row, overridden by a not-yet-synced local edit (the newer one).
  const merged = new Map<LocalDate, MergedCheckin>();
  for (const row of input.checkins) {
    merged.set(row.date, {
      date: row.date,
      weightKg: row.weightKg,
      mood: row.mood,
      sleepHours: row.sleepHours,
      // A photo path that is not under this user's folder is never shown.
      photoPath: row.photoPath?.startsWith(ownPrefix) ? row.photoPath : null,
      pending: false,
      localPhotoUri: null,
    });
  }
  for (const op of input.pending) {
    if (op.kind !== 'checkin') continue;
    const existing = merged.get(op.date);
    merged.set(op.date, {
      date: op.date,
      weightKg: op.weightKg,
      mood: op.mood,
      sleepHours: op.sleepHours,
      photoPath: existing?.photoPath ?? null,
      pending: true,
      localPhotoUri: op.photoUri,
    });
  }

  const entries = [...merged.values()];
  const byDateAsc = [...entries].sort((a, b) => a.date.localeCompare(b.date));

  const weightPoints: WeightPoint[] = byDateAsc
    .filter((entry) => entry.weightKg !== null)
    .map((entry) => ({ date: entry.date, weightKg: entry.weightKg as number, pending: entry.pending }));

  const history: HistoryEntry[] = [...byDateAsc].reverse().map(({ localPhotoUri: _local, ...entry }) => entry);

  const photos: PhotoEntry[] = byDateAsc.flatMap((entry): PhotoEntry[] => {
    if (entry.localPhotoUri) return [{ date: entry.date, path: null, localUri: entry.localPhotoUri, pending: true }];
    if (entry.photoPath) return [{ date: entry.date, path: entry.photoPath, localUri: null, pending: false }];
    return [];
  });

  // Workout days: synced logs count as synced; a date is pending only if every log is unsynced.
  const syncedWorkoutDates = new Set(input.workoutLogs.map((log) => log.date));
  const pendingWorkoutDates = new Set(
    input.pending.flatMap((op) => (op.kind === 'workout_set' ? [op.date] : []))
  );

  const calendar: CalendarCell[] = Array.from({ length: PLAN_LENGTH }, (_, index) => {
    const dayNumber = index + 1;
    const date = addLocalDays(input.plan.startDate, index);
    const day = input.days.find((d) => d.dayNumber === dayNumber);
    const isWorkoutDay = day?.workout.kind === 'workout';
    const checkin = merged.get(date);
    const hasCheckin = checkin !== undefined;
    const hasWorkout = syncedWorkoutDates.has(date) || pendingWorkoutDates.has(date);
    const pending =
      (hasCheckin && checkin.pending) || (!syncedWorkoutDates.has(date) && pendingWorkoutDates.has(date));

    let state: CalendarState;
    if (hasCheckin && (!isWorkoutDay || hasWorkout)) state = 'complete';
    else if (hasCheckin || hasWorkout) state = 'partial';
    else if (date >= input.today) state = 'upcoming';
    else state = 'missed';

    return { dayNumber, date, state, isToday: date === input.today, pending };
  });

  return { weightPoints, history, photos, calendar };
}
