import { enqueue } from '../sync/queue';
import type { LocalDate } from '../sync/types';
import { kgFromLb, parseDecimal } from '../onboarding/units';

const MAX_REPS = 100;
const MAX_WEIGHT_KG = 500;
const round1 = (n: number) => Math.round(n * 10) / 10;

export type SetField = 'reps' | 'weight';
export type SetParse =
  | { ok: true; reps: number; weightKg: number }
  | { ok: false; field: SetField; reason: 'invalid' | 'min' | 'max' };

// Reps are whole numbers; a blank weight means bodyweight. Weight is stored in kilograms.
export function parseSetFields(input: { reps: string; weight: string; units: 'metric' | 'imperial' }): SetParse {
  const reps = parseDecimal(input.reps);
  if (reps === null || !Number.isInteger(reps)) return { ok: false, field: 'reps', reason: 'invalid' };
  if (reps < 1) return { ok: false, field: 'reps', reason: 'min' };
  if (reps > MAX_REPS) return { ok: false, field: 'reps', reason: 'max' };

  const weight = input.weight.trim() === '' ? 0 : parseDecimal(input.weight);
  if (weight === null) return { ok: false, field: 'weight', reason: 'invalid' };
  const weightKg = round1(input.units === 'imperial' ? kgFromLb(weight) : weight);
  if (weightKg > MAX_WEIGHT_KG) return { ok: false, field: 'weight', reason: 'max' };
  return { ok: true, reps, weightKg };
}

// cyrb128: a small non-cryptographic 128-bit hash, enough to make a stable id from a seed.
function hash128(seed: string): number[] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

// One stable UUID per user, day, exercise and set number, so a double tap, a retry or a
// re-log of the same set always addresses the same server row.
export function setLogId(userId: string, date: LocalDate, exerciseId: string, setNumber: number): string {
  const hex = hash128(`${userId}|${date}|${exerciseId}|${setNumber}`)
    .map((part) => part.toString(16).padStart(8, '0'))
    .join('');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface WorkoutSetInput {
  exerciseId: string;
  setNumber: number;
  reps: string;
  weight: string;
  units: 'metric' | 'imperial';
}

export async function queueWorkoutSet(userId: string, day: LocalDate, set: WorkoutSetInput): Promise<string> {
  const parsed = parseSetFields(set);
  if (!parsed.ok) throw new Error(`Invalid ${parsed.field}: ${parsed.reason}`);
  if (!Number.isInteger(set.setNumber) || set.setNumber < 1) throw new Error('Invalid set number');
  const id = setLogId(userId, day, set.exerciseId, set.setNumber);
  await enqueue(userId, {
    kind: 'workout_set',
    id,
    date: day,
    exerciseId: set.exerciseId,
    setNumber: set.setNumber,
    reps: parsed.reps,
    weightKg: parsed.weightKg,
    updatedAt: Date.now(),
  });
  return id;
}

export interface LoggedSet {
  id: string;
  exerciseId: string;
  setNumber: number;
  reps: number;
  weightKg: number;
}
export interface SessionSet extends LoggedSet {
  pending: boolean;
}
export interface SessionSummary {
  completedSets: number;
  totalReps: number;
  volumeKg: number;
}

export function summarizeSession(sets: { reps: number; weightKg: number }[]): SessionSummary {
  return {
    completedSets: sets.length,
    totalReps: sets.reduce((sum, set) => sum + set.reps, 0),
    volumeKg: round1(sets.reduce((sum, set) => sum + set.reps * set.weightKg, 0)),
  };
}

// Server rows and not-yet-synced rows describe the same set when ids match; show it once,
// preferring the pending copy (it is the newer local edit).
export function mergeSets(server: LoggedSet[], pending: LoggedSet[]): SessionSet[] {
  const byId = new Map<string, SessionSet>();
  for (const set of server) byId.set(set.id, { ...set, pending: false });
  for (const set of pending) byId.set(set.id, { ...set, pending: true });
  return [...byId.values()].sort((a, b) => a.setNumber - b.setNumber);
}

export function nextSetNumber(sets: SessionSet[], exerciseId: string): number {
  return sets.filter((set) => set.exerciseId === exerciseId).reduce((max, set) => Math.max(max, set.setNumber), 0) + 1;
}

// Rest timer from device timestamps, so it stays correct after the app was backgrounded.
export function restRemaining(startedAtMs: number, nowMs: number, durationSec: number): number {
  const elapsedSec = Math.floor((nowMs - startedAtMs) / 1000);
  return Math.min(durationSec, Math.max(0, durationSec - Math.max(0, elapsedSec)));
}

export function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
