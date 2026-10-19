// The published exercise catalogue as the app reads it: only published exercises, the newest version of each, kept
// on this phone per account so names and cues are still there with no signal. A row that is not the expected shape
// is skipped, never shown half-formed. With nothing read and no network the answer is simply an empty list.
import { readCache, writeCache } from '../cache/userCache';
import { supabase } from '../lib/supabase';
import type { ExerciseVersion } from './catalogue';

const isLocalised = (v: unknown): boolean => {
  const l = v as Record<string, unknown> | null;
  return typeof l === 'object' && l !== null && typeof l.en === 'string' && typeof l.ms === 'string' && typeof l.ta === 'string';
};

function toExercise(row: unknown): ExerciseVersion | null {
  const r = row as Record<string, unknown> | null;
  if (!r || typeof r.id !== 'string' || typeof r.version !== 'number' || typeof r.pattern !== 'string' || typeof r.equipment !== 'string') return null;
  if (!isLocalised(r.name) || !Array.isArray(r.cues) || !r.cues.every(isLocalised)) return null;
  if (!Array.isArray(r.regressions) || !Array.isArray(r.alternatives)) return null;
  return r as unknown as ExerciseVersion;
}

function newestPerId(rows: unknown[]): ExerciseVersion[] {
  const newest = new Map<string, ExerciseVersion>();
  for (const row of rows) {
    const exercise = toExercise(row);
    if (!exercise) continue;
    const seen = newest.get(exercise.id);
    if (!seen || exercise.version > seen.version) newest.set(exercise.id, exercise);
  }
  return [...newest.values()];
}

export async function loadExercises(userId: string): Promise<ExerciseVersion[]> {
  try {
    const { data, error } = await supabase
      .from('exercise_versions')
      .select('id, version, pattern, equipment, name, cues, regressions, alternatives, media, reviewer, status')
      .eq('status', 'published');
    if (!error && Array.isArray(data)) {
      const exercises = newestPerId(data);
      await writeCache(userId, 'catalogue', exercises);
      return exercises;
    }
  } catch {
    // Offline: fall back to what was read last.
  }
  const cached = await readCache<unknown[]>(userId, 'catalogue');
  return Array.isArray(cached) ? newestPerId(cached) : [];
}
