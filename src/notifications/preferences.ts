// The person's reminder choices, kept on this phone for this account only. They start switched off: a reminder is
// only ever scheduled after the person chooses one. A damaged stored value means "off", never a guessed schedule.
import { readCache, writeCache } from '../cache/userCache';
import type { ReminderPreferences } from './schedule';

export const DEFAULT_REMINDERS: ReminderPreferences = {
  enabled: false,
  category: 'workout',
  time: '18:00',
  quietStart: null,
  quietEnd: null,
  pausedCategories: [],
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function valid(value: unknown): value is ReminderPreferences {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const quietOk = (v.quietStart === null && v.quietEnd === null) || (typeof v.quietStart === 'string' && TIME.test(v.quietStart) && typeof v.quietEnd === 'string' && TIME.test(v.quietEnd));
  return (
    typeof v.enabled === 'boolean' &&
    typeof v.category === 'string' &&
    v.category.length > 0 &&
    typeof v.time === 'string' &&
    TIME.test(v.time) &&
    quietOk &&
    Array.isArray(v.pausedCategories) &&
    v.pausedCategories.every((c) => typeof c === 'string')
  );
}

export async function loadReminders(userId: string): Promise<ReminderPreferences> {
  const stored = await readCache<unknown>(userId, 'reminders');
  return valid(stored) ? stored : { ...DEFAULT_REMINDERS };
}

// False (and nothing saved) when the value is malformed.
export async function saveReminders(userId: string, prefs: ReminderPreferences): Promise<boolean> {
  if (!valid(prefs)) return false;
  await writeCache(userId, 'reminders', prefs);
  return true;
}
