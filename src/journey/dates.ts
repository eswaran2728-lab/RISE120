// Journey dates. A member's day runs on the calendar where they are (Kuala Lumpur and Singapore share one), not
// on UTC. UTC is still what resets the daily allowances; that is a different clock and lives on the server.
// A missing or invalid zone means the phone's own zone, which is what the app did before zones existed.
import { dayNumberFor, localDateString } from '../lib/dates';
import type { LocalDate } from '../sync/types';
import type { Region } from './types';

const ZONE_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !ZONE_SHAPE.test(zone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

export function dateInZone(now: Date, zone: string | null | undefined): LocalDate {
  if (!isValidTimeZone(zone)) return localDateString(now);
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

// Day 1 is the start date. Callers treat below 1 as not started and above 120 as finished.
export function journeyDay(startDate: LocalDate, now: Date, zone: string | null | undefined): number {
  return dayNumberFor(startDate, dateInZone(now, zone));
}

const DAY_SEARCH_MS = 26 * 3_600_000; // longer than any local day (the longest is 25 hours)

// Milliseconds until the member's calendar date next changes. Found by searching for the instant the date
// changes, so a 23-hour or 25-hour daylight-saving day is exact rather than off by an hour.
export function msUntilNextDay(now: Date, zone: string | null | undefined): number {
  const today = dateInZone(now, zone);
  let low = 0; // the date is still today at now + low
  let high = DAY_SEARCH_MS; // the date has changed by now + high
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (dateInZone(new Date(now.getTime() + mid), zone) === today) low = mid;
    else high = mid;
  }
  return high;
}

// A starting suggestion only. The member can choose another zone, and the phone's own zone is used when unset.
export function regionDefaultZone(region: Region | null): string | null {
  if (region === 'MY') return 'Asia/Kuala_Lumpur';
  if (region === 'SG') return 'Asia/Singapore';
  return null;
}
