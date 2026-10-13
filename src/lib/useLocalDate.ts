import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { localDateString } from './dates';
import type { LocalDate } from '../sync/types';

// The device's local calendar date, kept fresh: it rolls over at local midnight and when the app
// returns to the foreground, so a screen left open overnight does not keep showing yesterday.
export function useLocalDate(): LocalDate {
  const [date, setDate] = useState<LocalDate>(() => localDateString());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
      timer = setTimeout(() => {
        setDate(localDateString());
        schedule();
      }, nextMidnight.getTime() - now.getTime());
    };

    schedule();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setDate(localDateString());
      if (timer) clearTimeout(timer);
      schedule();
    });

    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  return date;
}
