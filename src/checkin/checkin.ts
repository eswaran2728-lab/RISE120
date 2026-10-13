import { enqueue } from '../sync/queue';
import type { LocalDate } from '../sync/types';
import { kgFromLb, parseDecimal } from '../onboarding/units';

// Check-in contract: weight 30-300 kg (matches the database check), sleep 0-24 hours,
// mood a whole number from 1 (very low) to 5 (great). All three are required; the photo is optional.
const MIN_WEIGHT_KG = 30;
const MAX_WEIGHT_KG = 300;
const MAX_SLEEP_HOURS = 24;
export const MOOD_MIN = 1;
export const MOOD_MAX = 5;

const round1 = (n: number) => Math.round(n * 10) / 10;

export type CheckinField = 'weight' | 'sleep' | 'mood';
export type CheckinParse =
  | { ok: true; weightKg: number; sleepHours: number; mood: number }
  | { ok: false; field: CheckinField; reason: 'invalid' | 'min' | 'max' };

export interface CheckinFields {
  weight: string;
  sleep: string;
  mood: number | null;
  units: 'metric' | 'imperial';
}

export function parseCheckinFields(input: CheckinFields): CheckinParse {
  const weight = parseDecimal(input.weight);
  if (weight === null) return { ok: false, field: 'weight', reason: 'invalid' };
  const weightKg = round1(input.units === 'imperial' ? kgFromLb(weight) : weight);
  if (weightKg < MIN_WEIGHT_KG) return { ok: false, field: 'weight', reason: 'min' };
  if (weightKg > MAX_WEIGHT_KG) return { ok: false, field: 'weight', reason: 'max' };

  const sleepHours = parseDecimal(input.sleep);
  if (sleepHours === null) return { ok: false, field: 'sleep', reason: 'invalid' };
  if (sleepHours > MAX_SLEEP_HOURS) return { ok: false, field: 'sleep', reason: 'max' };

  const { mood } = input;
  if (mood === null || !Number.isInteger(mood) || mood < MOOD_MIN || mood > MOOD_MAX) {
    return { ok: false, field: 'mood', reason: 'invalid' };
  }
  return { ok: true, weightKg, sleepHours, mood };
}

// photoUri is a local file copy (see photos.ts); leave it out when the photo is unchanged.
export async function queueCheckin(
  userId: string,
  date: LocalDate,
  input: CheckinFields & { photoUri?: string | null }
): Promise<void> {
  const parsed = parseCheckinFields(input);
  if (!parsed.ok) throw new Error(`Invalid ${parsed.field}: ${parsed.reason}`);
  await enqueue(userId, {
    kind: 'checkin',
    date,
    weightKg: parsed.weightKg,
    mood: parsed.mood,
    sleepHours: parsed.sleepHours,
    photoUri: input.photoUri ?? null,
    updatedAt: Date.now(),
  });
}
