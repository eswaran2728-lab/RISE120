// When the next personal reminder should fire. Pure: no clock, no device, no network. The caller schedules the
// returned instant locally and reschedules by calling this again, so one preference set yields one notification.
import { addLocalDays } from '../lib/dates';
import { dateInZone } from '../journey/dates';

export interface ReminderPreferences {
  enabled: boolean;
  category: string;
  time: string; // HH:MM, local to the person
  quietStart: string | null; // HH:MM; with quietEnd, nothing fires in [start, end); may cross midnight
  quietEnd: string | null;
  pausedCategories: string[];
}

const minutesOf = (value: string | null): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : null;
};

function localMs(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
}

const offsetAt = (at: Date, zone: string) => localMs(at, zone) - Math.floor(at.getTime() / 1000) * 1000;

// The instant at which the wall clock in `zone` reads `date` `minutes`. A time skipped by a clock change moves
// forward to the first real moment after it; a repeated time uses its first occurrence.
function instantFor(date: string, minutes: number, zone: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const wanted = Date.UTC(y, mo - 1, d, 0, minutes);
  const day = 24 * 3600 * 1000;
  const candidates = [offsetAt(new Date(wanted - day), zone), offsetAt(new Date(wanted + day), zone)].map((off) => new Date(wanted - off));
  const exact = candidates.filter((c) => localMs(c, zone) === wanted).sort((a, b) => a.getTime() - b.getTime());
  return exact[0] ?? (candidates[0].getTime() > candidates[1].getTime() ? candidates[0] : candidates[1]);
}

export function nextReminder(prefs: ReminderPreferences, completedToday: boolean, now: Date, timeZone: string): Date | null {
  if (!prefs.enabled || prefs.pausedCategories.includes(prefs.category)) return null;
  const at = minutesOf(prefs.time);
  if (at === null) return null;
  const hasQuiet = prefs.quietStart !== null || prefs.quietEnd !== null;
  const qs = minutesOf(prefs.quietStart);
  const qe = minutesOf(prefs.quietEnd);
  if (hasQuiet && (qs === null || qe === null)) return null;

  const today = dateInZone(now, timeZone);
  for (let k = completedToday ? 1 : 0; k < 4; k++) {
    let date = addLocalDays(today, k);
    let minutes = at;
    if (hasQuiet && qs !== null && qe !== null && qs !== qe) {
      const crosses = qs > qe;
      if (crosses ? at >= qs : false) {
        date = addLocalDays(date, 1);
        minutes = qe;
      } else if (crosses ? at < qe : at >= qs && at < qe) {
        minutes = qe;
      }
    }
    const instant = instantFor(date, minutes, timeZone);
    if (instant.getTime() > now.getTime()) return instant;
  }
  return null;
}
