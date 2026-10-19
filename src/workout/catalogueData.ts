// The published exercise catalogue as the app reads it: only published exercises, the newest version of each, kept
// on this phone per account so names and cues are still there with no signal. A row that is not the expected shape
// is skipped, never shown half-formed. With nothing read and no network the answer is simply an empty list.
import { readCache, writeCache } from '../cache/userCache';
import { supabase } from '../lib/supabase';
import type { ExerciseVersion, SessionTemplate } from './catalogue';

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

function toTemplate(row: unknown): SessionTemplate | null {
  const r = row as Record<string, unknown> | null;
  if (!r || typeof r.id !== 'string' || typeof r.version !== 'number' || typeof r.goal !== 'string' || typeof r.level !== 'string') return null;
  if (typeof r.minutes !== 'number' || (r.location !== 'home' && r.location !== 'gym')) return null;
  const dayType = r.day_type ?? r.dayType;
  if (dayType !== 'training' && dayType !== 'recovery') return null;
  if (!Array.isArray(r.exercises) || r.exercises.length === 0) return null;
  const exercises = r.exercises.map((x) => x as Record<string, unknown>);
  if (!exercises.every((x) => typeof x.exerciseId === 'string' && typeof x.sets === 'number' && typeof x.reps === 'number')) return null;
  return {
    id: r.id,
    version: r.version,
    goal: r.goal as SessionTemplate['goal'],
    level: r.level as SessionTemplate['level'],
    minutes: r.minutes as SessionTemplate['minutes'],
    location: r.location,
    dayType,
    exercises: exercises.map((x) => ({ exerciseId: x.exerciseId as string, sets: x.sets as number, reps: x.reps as number })),
    reviewer: (r.reviewer as SessionTemplate['reviewer']) ?? null,
    status: (r.status as SessionTemplate['status']) ?? 'published',
  };
}

function newestTemplates(rows: unknown[]): SessionTemplate[] {
  const newest = new Map<string, SessionTemplate>();
  for (const row of rows) {
    const template = toTemplate(row);
    if (!template) continue;
    const seen = newest.get(template.id);
    if (!seen || template.version > seen.version) newest.set(template.id, template);
  }
  return [...newest.values()];
}

// Published session templates, newest version of each, kept on this phone per account for offline use.
export async function loadSessionTemplates(userId: string): Promise<SessionTemplate[]> {
  try {
    const { data, error } = await supabase
      .from('session_templates')
      .select('id, version, goal, level, minutes, location, day_type, exercises, reviewer, status')
      .eq('status', 'published');
    if (!error && Array.isArray(data)) {
      const sessions = newestTemplates(data);
      await writeCache(userId, 'sessions', sessions);
      return sessions;
    }
  } catch {
    // Offline: fall back to what was read last.
  }
  const cached = await readCache<unknown[]>(userId, 'sessions');
  return Array.isArray(cached) ? newestTemplates(cached) : [];
}

