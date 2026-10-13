import type { LocalDate } from '../sync/types';

const pad = (n: number) => String(n).padStart(2, '0');

// The user's local calendar date. Never derive this from toISOString(), which is UTC.
export function localDateString(date: Date = new Date()): LocalDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Whole calendar days are counted with UTC arithmetic on the date parts, so daylight-saving
// shifts and the device time zone cannot move a day.
function utcDay(date: LocalDate): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

export function dayNumberFor(startDate: LocalDate, localDate: LocalDate): number {
  return utcDay(localDate) - utcDay(startDate) + 1;
}

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}
