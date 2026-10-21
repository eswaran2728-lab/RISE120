// Local calendar days, worked out from an explicit zone-offset function so the time-zone behaviour is testable and does not
// depend on the machine running the tests. In the app the offset is the phone's own zone at that instant.
export type OffsetAt = (ms: number) => number; // minutes east of UTC at that instant

export const deviceOffsetAt: OffsetAt = (ms) => -new Date(ms).getTimezoneOffset();

const pad = (n: number) => String(n).padStart(2, '0');

export function localDate(ms: number, offsetAt: OffsetAt): string {
  const d = new Date(ms + offsetAt(ms) * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + n));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

// The instant a local day starts. Done twice so a zone change around midnight (clocks going back or forward) is honoured.
function startOfDay(date: string, offsetAt: OffsetAt): number {
  const [y, m, d] = date.split('-').map(Number);
  const midnightUtc = Date.UTC(y, m - 1, d);
  let start = midnightUtc - offsetAt(midnightUtc) * 60000;
  const corrected = midnightUtc - offsetAt(start) * 60000;
  if (corrected !== start) start = corrected;
  return start;
}

export interface DayWindow {
  days: string[]; // oldest first, ending today
  starts: string[]; // ISO instant each local day starts
  end: string; // ISO instant the last day ends
}

export function buildWindow(today: string, length: number, offsetAt: OffsetAt): DayWindow {
  const days = Array.from({ length }, (_, i) => addDays(today, i - (length - 1)));
  return {
    days,
    starts: days.map((day) => new Date(startOfDay(day, offsetAt)).toISOString()),
    end: new Date(startOfDay(addDays(today, 1), offsetAt)).toISOString(),
  };
}
