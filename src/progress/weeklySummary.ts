// A plain summary of the last seven days, from what was logged. It reports observations and how complete the data
// is, never a verdict and never a cause: no diagnosis, no "because", and a quiet week is described as "nothing was
// logged", not "you did nothing". Strength is compared only for the same exercise in both weeks. Body measurements
// are left out entirely when the member has hidden them.
import { addLocalDays } from '../lib/dates';
import type { LocalDate } from '../sync/types';

export interface SummaryLog {
  id: string; // a set that appears twice with the same id counts once
  date: LocalDate;
  exerciseId?: string;
  reps?: number;
  weightKg?: number | null;
}

export interface SummaryCheckin {
  date: LocalDate;
  weightKg: number | null;
}

export interface WeeklySummaryInput {
  today: LocalDate;
  logs: SummaryLog[];
  checkins: SummaryCheckin[];
  pendingOps: number; // entries on this phone that have not synced yet
  showBodyMetrics: boolean;
}

export type StrengthChange = 'up' | 'same' | 'down';

export interface StrengthComparison {
  exerciseId: string;
  topWeightKg: number;
  previousTopWeightKg: number;
  change: StrengthChange;
}

export type CoverageNote = 'no_logs' | 'pending_sync' | 'no_previous_week' | 'nothing_to_compare';

export interface WeeklySummary {
  window: { start: LocalDate; end: LocalDate };
  participation: { workoutDays: number; checkinDays: number };
  loggedSets: number;
  strength: StrengthComparison[];
  body: { weighIns: number; changeKg: number | null } | null;
  coverage: { daysInWindow: number; daysWithAnyLog: number; pendingSync: number; notes: CoverageNote[] };
}

const WINDOW_DAYS = 7;
const SAME_WEIGHT_EPSILON = 0.01;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function summariseWeek(input: WeeklySummaryInput): WeeklySummary {
  const start = addLocalDays(input.today, -(WINDOW_DAYS - 1));
  const end = input.today;
  const previousStart = addLocalDays(start, -WINDOW_DAYS);
  const previousEnd = addLocalDays(start, -1);
  const within = (date: LocalDate, from: LocalDate, to: LocalDate) => date >= from && date <= to;

  const seen = new Set<string>();
  const logs = input.logs.filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
  const current = logs.filter((l) => within(l.date, start, end));
  const previous = logs.filter((l) => within(l.date, previousStart, previousEnd));
  const checkins = input.checkins.filter((c) => within(c.date, start, end));

  const workoutDates = new Set(current.map((l) => l.date));
  const checkinDates = new Set(checkins.map((c) => c.date));
  const anyDates = new Set([...workoutDates, ...checkinDates]);

  const topWeights = (rows: SummaryLog[]) => {
    const tops = new Map<string, number>();
    for (const row of rows) {
      if (!row.exerciseId || typeof row.weightKg !== 'number' || !(row.weightKg > 0)) continue;
      tops.set(row.exerciseId, Math.max(tops.get(row.exerciseId) ?? 0, row.weightKg));
    }
    return tops;
  };
  const now = topWeights(current);
  const before = topWeights(previous);
  const strength: StrengthComparison[] = [...now.keys()]
    .filter((id) => before.has(id))
    .sort()
    .map((id) => {
      const top = now.get(id)!;
      const prev = before.get(id)!;
      const change: StrengthChange = Math.abs(top - prev) < SAME_WEIGHT_EPSILON ? 'same' : top > prev ? 'up' : 'down';
      return { exerciseId: id, topWeightKg: top, previousTopWeightKg: prev, change };
    });

  let body: WeeklySummary['body'] = null;
  if (input.showBodyMetrics) {
    const byDate = new Map<LocalDate, number>();
    for (const c of checkins) if (c.weightKg !== null) byDate.set(c.date, c.weightKg);
    const ordered = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, kg]) => kg);
    body = { weighIns: ordered.length, changeKg: ordered.length >= 2 ? round1(ordered[ordered.length - 1] - ordered[0]) : null };
  }

  const notes: CoverageNote[] = [];
  if (anyDates.size === 0) notes.push('no_logs');
  if (input.pendingOps > 0) notes.push('pending_sync');
  if (strength.length === 0 && current.length > 0) notes.push(previous.length === 0 ? 'no_previous_week' : 'nothing_to_compare');

  return {
    window: { start, end },
    participation: { workoutDays: workoutDates.size, checkinDays: checkinDates.size },
    loggedSets: current.length,
    strength,
    body,
    coverage: { daysInWindow: WINDOW_DAYS, daysWithAnyLog: anyDates.size, pendingSync: input.pendingOps, notes },
  };
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

// Statements for the coach's context. Every one is about what was LOGGED, so missing logs can never be read as
// "did nothing" or "ate nothing".
export function toCoachFacts(summary: WeeklySummary, names: Record<string, string> = {}): string[] {
  const { window, participation, coverage, strength, body } = summary;
  const facts: string[] = [];
  if (coverage.notes.includes('no_logs')) {
    facts.push(`There are no workout logs or check-ins from ${window.start} to ${window.end}. Logs may be missing, so this does not mean nothing happened.`);
  } else {
    facts.push(`From ${window.start} to ${window.end} there ${participation.workoutDays === 1 ? 'is' : 'are'} ${days(participation.workoutDays)} with a logged workout and ${days(participation.checkinDays)} with a logged check-in.`);
  }
  for (const s of strength) {
    const label = names[s.exerciseId] ?? s.exerciseId;
    facts.push(`${label}: top logged weight ${s.topWeightKg} kg this week and ${s.previousTopWeightKg} kg the week before.`);
  }
  if (body && body.weighIns > 0) {
    facts.push(body.changeKg === null ? `There is ${body.weighIns} logged weigh-in this week.` : `There are ${body.weighIns} logged weigh-ins this week; from the first to the last the logged weight changed by ${body.changeKg} kg.`);
  }
  if (coverage.pendingSync > 0) {
    facts.push(`${coverage.pendingSync} ${coverage.pendingSync === 1 ? 'entry is' : 'entries are'} still waiting to sync, so this may be incomplete.`);
  }
  return facts;
}
