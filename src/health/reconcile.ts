// Turns what Health Connect returned into one value per local day, and works out what changed since the last read. Pure:
// no I/O, no clock, no zone except the ones passed in.
//
//   * Steps come as per-day totals that Health Connect has already de-duplicated across apps (the platform advises
//     aggregating for exactly this reason), so they are used as they are.
//   * Sleep sessions are merged as intervals, so overlapping sessions from two apps count once. A night belongs to the
//     local day the person woke up, by the zone recorded with the session when there is one.
//   * Re-reading the whole window every time means an edited or deleted source record simply changes or removes that
//     day's copy; there is no per-record state to drift.
import { addDays, buildWindow, DayWindow, localDate, OffsetAt } from './days';
import { ImportedDay, KEEP_DAYS } from './types';

export interface RawSleep {
  id: string | null;
  origin: string | null;
  start: string; // ISO instant
  end: string;
  endOffsetMinutes: number | null; // the zone the session ended in, when the record says
  stages: { start: string; end: string; type: number }[] | null;
}

export interface DayValue {
  value: number;
  origins: string[];
}

const MAX_SLEEP_MS = 24 * 3600000;
const MAX_STEPS = 200000;
const NOT_ASLEEP = new Set([1, 3, 7]); // awake, out of bed, awake in bed

const sortedUnique = (values: (string | null | undefined)[]) => [...new Set(values.filter((v): v is string => typeof v === 'string' && v !== ''))].sort();

export function stepsByDay(groups: { count: number | null; origins: string[] }[], window: DayWindow): Record<string, DayValue> {
  const out: Record<string, DayValue> = {};
  window.days.forEach((day, index) => {
    const group = groups[index];
    if (!group || typeof group.count !== 'number' || !Number.isFinite(group.count)) return;
    const steps = Math.round(group.count);
    if (steps <= 0 || steps > MAX_STEPS) return;
    out[day] = { value: steps, origins: sortedUnique(group.origins) };
  });
  return out;
}

interface Interval {
  start: number;
  end: number;
}

// The parts of a session that count as sleep: its asleep stages, or all of it when it has none.
function asleepIntervals(session: RawSleep, start: number, end: number): Interval[] {
  if (!session.stages || session.stages.length === 0) return [{ start, end }];
  const parts: Interval[] = [];
  for (const stage of session.stages) {
    const s = Date.parse(stage.start);
    const e = Date.parse(stage.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || NOT_ASLEEP.has(stage.type)) continue;
    parts.push({ start: Math.max(s, start), end: Math.min(e, end) });
  }
  return parts.filter((p) => p.end > p.start);
}

function mergedMinutes(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let current: Interval | null = null;
  for (const interval of sorted) {
    if (current && interval.start <= current.end) current.end = Math.max(current.end, interval.end);
    else {
      if (current) total += current.end - current.start;
      current = { ...interval };
    }
  }
  if (current) total += current.end - current.start;
  return Math.round(total / 60000);
}

export function sleepByDay(sessions: RawSleep[], window: DayWindow, nowMs: number, offsetAt: OffsetAt): Record<string, DayValue> {
  const seen = new Set<string>();
  const byDay = new Map<string, { intervals: Interval[]; origins: (string | null)[] }>();

  for (const session of sessions) {
    if (session.id) {
      if (seen.has(session.id)) continue; // the same record returned twice
      seen.add(session.id);
    }
    const start = Date.parse(session.start);
    const end = Date.parse(session.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > nowMs || end - start > MAX_SLEEP_MS) continue;

    const day = session.endOffsetMinutes !== null ? localDate(end, () => session.endOffsetMinutes as number) : localDate(end, offsetAt);
    if (!window.days.includes(day)) continue;

    const entry = byDay.get(day) ?? { intervals: [], origins: [] };
    entry.intervals.push(...asleepIntervals(session, start, end));
    entry.origins.push(session.origin);
    byDay.set(day, entry);
  }

  const out: Record<string, DayValue> = {};
  for (const [day, entry] of byDay) {
    const minutes = Math.min(1440, mergedMinutes(entry.intervals));
    if (minutes > 0) out[day] = { value: minutes, origins: sortedUnique(entry.origins) };
  }
  return out;
}

export interface Reconciled {
  next: Record<string, ImportedDay>;
  added: number;
  updated: number;
  removed: number;
}

const revisionOf = (value: DayValue) => `${value.value}|${value.origins.join(',')}`;

// Days inside the window take exactly what was just read (so a deleted record removes its day); days outside it are kept
// as they are, because this read cannot re-check them, until they are older than the journey.
export function reconcileDays(existing: Record<string, ImportedDay>, incoming: Record<string, DayValue>, window: DayWindow, today: string): Reconciled {
  const inWindow = new Set(window.days);
  const oldest = addDays(today, -(KEEP_DAYS - 1));
  const next: Record<string, ImportedDay> = {};
  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const [day, previous] of Object.entries(existing)) {
    if (inWindow.has(day)) continue;
    if (day >= oldest && day <= today) next[day] = previous;
  }
  for (const day of window.days) {
    const fresh = incoming[day];
    const previous = existing[day];
    if (!fresh) {
      if (previous) removed += 1;
      continue;
    }
    const revision = revisionOf(fresh);
    if (!previous) added += 1;
    else if (previous.revision !== revision) updated += 1;
    next[day] = previous && previous.revision === revision ? previous : { day, value: fresh.value, origins: fresh.origins, revision };
  }
  return { next, added, updated, removed };
}

export { buildWindow };
