// Pure helpers behind the Coach screen: what a proposal changes (exact before and after values), the retry
// countdown, and edits to the history list.
import { addLocalDays } from '../lib/dates';
import type { PlanWorkout } from '../plan/types';
import type { CoachExchange, CoachProposal, ProposalStatus } from './types';

export interface ExerciseValue {
  name: string | null; // null when the exercise is not known on this phone
  sets: number;
  reps: number;
}

export type ProposalLine =
  | { kind: 'workout'; rows: { position: number; before: ExerciseValue; after: ExerciseValue }[] }
  | { kind: 'calories' | 'protein'; before: number | null; after: number };

export interface ProposalDayView {
  dayNumber: number;
  date: string | null;
  lines: ProposalLine[];
}

interface Context {
  startDate: string | null;
  exerciseName: (id: string) => string | null;
}

function workoutRows(before: PlanWorkout, after: PlanWorkout, name: Context['exerciseName']) {
  if (before.kind !== 'workout' || after.kind !== 'workout') return [];
  const rows: { position: number; before: ExerciseValue; after: ExerciseValue }[] = [];
  after.exercises.forEach((next, index) => {
    const prior = before.exercises[index];
    if (!prior) return;
    if (prior.exercise_id === next.exercise_id && prior.sets === next.sets && prior.reps === next.reps) return;
    rows.push({
      position: index + 1,
      before: { name: name(prior.exercise_id), sets: prior.sets, reps: prior.reps },
      after: { name: name(next.exercise_id), sets: next.sets, reps: next.reps },
    });
  });
  return rows;
}

// The exact before and after values for every day a proposal names, in plan order. Only what a patch changes is
// listed. "Before" comes from the values the server recorded when the proposal was made.
export function describeProposal(proposal: CoachProposal, context: Context): ProposalDayView[] {
  return [...proposal.patches]
    .sort((a, b) => a.dayNumber - b.dayNumber)
    .map((patch) => {
      const lines: ProposalLine[] = [];
      if (patch.next.workout) {
        const rows = workoutRows(patch.expected.workout, patch.next.workout, context.exerciseName);
        if (rows.length > 0) lines.push({ kind: 'workout', rows });
      }
      if (patch.next.calorieTarget !== undefined) lines.push({ kind: 'calories', before: patch.expected.calorieTarget, after: patch.next.calorieTarget });
      if (patch.next.proteinTargetG !== undefined) lines.push({ kind: 'protein', before: patch.expected.proteinTargetG, after: patch.next.proteinTargetG });
      return { dayNumber: patch.dayNumber, date: context.startDate ? addLocalDays(context.startDate, patch.dayNumber - 1) : null, lines };
    });
}

// Whole seconds until the server's retry time, never negative. The time comes from the server; this only counts down.
export function retrySecondsLeft(retryAt: string | null, nowMs: number): number {
  const at = retryAt ? Date.parse(retryAt) : NaN;
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - nowMs) / 1000)) : 0;
}

export function upsertExchange(history: CoachExchange[], exchange: CoachExchange): CoachExchange[] {
  const index = history.findIndex((item) => item.requestId === exchange.requestId);
  if (index === -1) return [...history, exchange];
  const next = [...history];
  next[index] = exchange;
  return next;
}

export function withProposalStatus(history: CoachExchange[], proposalId: string, status: ProposalStatus): CoachExchange[] {
  return history.map((item) => (item.proposal?.id === proposalId ? { ...item, proposal: { ...item.proposal, status } } : item));
}

// A fresh read of the server's history, plus any local exchange the read did not include yet (an answer that
// arrived while the read was in flight).
export function mergeHistory(server: CoachExchange[], local: CoachExchange[]): CoachExchange[] {
  const known = new Set(server.map((item) => item.requestId));
  return [...server, ...local.filter((item) => !known.has(item.requestId))];
}
