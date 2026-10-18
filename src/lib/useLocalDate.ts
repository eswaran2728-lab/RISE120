import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { dateInZone, msUntilNextDay } from '../journey/dates';
import type { LocalDate } from '../sync/types';

// The member's calendar date, kept fresh: it rolls over at their local midnight and when the app returns to the
// foreground, so a screen left open overnight does not keep showing yesterday. With a journey time zone it is
// the date in that zone; without one it is the phone's own date, as before.
export function useLocalDate(timeZone?: string | null): LocalDate {
  const [seen, setSeen] = useState<{ zone: string | null | undefined; date: LocalDate }>(() => ({ zone: timeZone, date: dateInZone(new Date(), timeZone) }));
  // A zone chosen after the last refresh is read straight away rather than waiting for the next timer.
  const date = seen.zone === timeZone ? seen.date : dateInZone(new Date(), timeZone);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => setSeen({ zone: timeZone, date: dateInZone(new Date(), timeZone) });

    const schedule = () => {
      const now = new Date();
      // One extra second so the timer never fires just before the date changes.
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, msUntilNextDay(now, timeZone) + 1000);
    };

    schedule();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      refresh();
      if (timer) clearTimeout(timer);
      schedule();
    });

    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [timeZone]);

  return date;
}
