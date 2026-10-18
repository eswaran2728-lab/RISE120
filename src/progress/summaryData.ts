// Turns what the Progress screen already loaded into the input of the weekly summary: server logs and check-ins,
// plus whatever is still waiting to sync on this phone. A set that is both on the server and in the queue has the
// same id and counts once; a check-in waiting to sync wins over the server row for its day (it is the newer edit).
import type { LocalDate } from '../sync/types';
import type { ProgressInput } from './selectors';
import type { SummaryCheckin, SummaryLog, WeeklySummaryInput } from './weeklySummary';

export function summaryInputFrom(input: ProgressInput, showBodyMetrics: boolean): WeeklySummaryInput {
  const logs = new Map<string, SummaryLog>();
  for (const log of input.workoutLogs) logs.set(log.id, { id: log.id, date: log.date, exerciseId: log.exerciseId, reps: log.reps, weightKg: log.weightKg });
  for (const op of input.pending) {
    if (op.kind === 'workout_set' && !logs.has(op.id)) logs.set(op.id, { id: op.id, date: op.date, exerciseId: op.exerciseId, reps: op.reps, weightKg: op.weightKg });
  }

  const checkins = new Map<LocalDate, SummaryCheckin>();
  for (const row of input.checkins) checkins.set(row.date, { date: row.date, weightKg: row.weightKg });
  for (const op of input.pending) {
    if (op.kind === 'checkin') checkins.set(op.date, { date: op.date, weightKg: op.weightKg });
  }

  return { today: input.today, logs: [...logs.values()], checkins: [...checkins.values()], pendingOps: input.pending.length, showBodyMetrics };
}
