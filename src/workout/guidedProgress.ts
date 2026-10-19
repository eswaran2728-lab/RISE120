// The guided session started for one plan day, reduced to what progress needs: which session it is, whether the
// member finished it, and how many sets it plans for each logged-set exercise. Read from the account's own rows
// (row-level security) and remembered on this phone per account, so a launch with no signal still knows it. A
// session that was only started is "active": it counts for nothing until sets are logged or it is finished.
import { readCache, writeCache, clearCache } from '../cache/userCache';
import { supabase } from '../lib/supabase';
import { loadExerciseLinks } from './availability';
import { loadSessionExercises } from './sessionActions';

export interface GuidedProgress {
  sessionId: string;
  status: 'active' | 'completed';
  planned: { exerciseId: string; sets: number }[]; // exerciseId is the logged-set exercise, not the catalogue id
}

interface Remembered extends GuidedProgress {
  planId: string;
  dayNumber: number;
}

async function remembered(userId: string, planId: string, dayNumber: number): Promise<GuidedProgress | null> {
  const saved = await readCache<Remembered>(userId, 'guided');
  if (!saved || saved.planId !== planId || saved.dayNumber !== dayNumber || typeof saved.sessionId !== 'string' || !Array.isArray(saved.planned)) return null;
  return { sessionId: saved.sessionId, status: saved.status === 'completed' ? 'completed' : 'active', planned: saved.planned };
}

export async function loadGuidedProgress(userId: string, planId: string, dayNumber: number): Promise<GuidedProgress | null> {
  let rows: { id: string; status: string }[] | null = null;
  try {
    const answer = await supabase.from('workout_sessions').select('id, status').eq('plan_id', planId).eq('day_number', dayNumber);
    if (!answer.error && Array.isArray(answer.data)) rows = answer.data as { id: string; status: string }[];
  } catch {
    rows = null;
  }
  if (!rows) return remembered(userId, planId, dayNumber); // offline

  const row = rows.find((r) => r.status === 'active') ?? rows.find((r) => r.status === 'completed');
  if (!row) {
    await clearCache(userId, 'guided');
    return null;
  }

  const [session, links] = await Promise.all([loadSessionExercises(row.id).catch(() => null), loadExerciseLinks().catch(() => null)]);
  if (!session || !links) {
    const saved = await remembered(userId, planId, dayNumber);
    if (saved && saved.sessionId === row.id) return { ...saved, status: row.status === 'completed' ? 'completed' : saved.status };
    return null;
  }

  const planned = new Map<string, number>();
  for (const entry of session.exercises) {
    const uuid = links.get(entry.exerciseId);
    if (uuid) planned.set(uuid, (planned.get(uuid) ?? 0) + entry.sets);
  }
  const progress: GuidedProgress = {
    sessionId: row.id,
    status: row.status === 'completed' || session.status === 'completed' ? 'completed' : 'active',
    planned: [...planned.entries()].map(([exerciseId, sets]) => ({ exerciseId, sets })),
  };
  await writeCache(userId, 'guided', { ...progress, planId, dayNumber } satisfies Remembered);
  return progress;
}
