// What the guided-session card should offer for today's plan day. A session already started for that plan and day
// always comes first (resume or done), even with no signal and no catalogue. Otherwise sessions are offered only
// from the published, reviewed catalogue, and only those whose every exercise can be logged (it has a link). With
// nothing suitable the answer is "unavailable": content is never invented to fill the screen.
import { supabase } from '../lib/supabase';
import { loadExerciseLinks } from './availability';
import type { CatalogueInput, Equipment, Goal, Level } from './catalogue';
import { loadExercises, loadSessionTemplates } from './catalogueData';

export interface GuidedProfile {
  equipment: Equipment;
  location: 'home' | 'gym';
  goal: Goal;
  level: Level;
}

export type GuidedState =
  | { kind: 'unavailable'; reason: 'no_catalogue' | 'no_links' | 'unreadable' }
  | { kind: 'active'; sessionId: string }
  | { kind: 'done'; sessionId: string }
  | { kind: 'choose'; catalogue: CatalogueInput; profile: GuidedProfile };

const EQUIPMENT: Equipment[] = ['gym', 'home', 'none'];
const GOALS: Goal[] = ['lose_fat', 'build_muscle', 'recomp'];
const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];
const UNREADABLE: GuidedState = { kind: 'unavailable', reason: 'unreadable' };

export async function loadGuidedState(input: { userId: string; planId: string; dayNumber: number }): Promise<GuidedState> {
  const started = await supabase.from('workout_sessions').select('id, status').eq('plan_id', input.planId).eq('day_number', input.dayNumber);
  if (started.error || !Array.isArray(started.data)) return UNREADABLE;
  const sessions = started.data as { id: string; status: string }[];
  const live = sessions.find((s) => s.status === 'active');
  if (live) return { kind: 'active', sessionId: live.id };
  const finished = sessions.find((s) => s.status === 'completed');
  if (finished) return { kind: 'done', sessionId: finished.id };

  const [exercises, templates, links] = await Promise.all([loadExercises(input.userId), loadSessionTemplates(input.userId), loadExerciseLinks().catch(() => null)]);
  if (exercises.length === 0 || templates.length === 0) return { kind: 'unavailable', reason: 'no_catalogue' };
  if (!links) return UNREADABLE;
  const loggable = templates.filter((template) => template.exercises.every((x) => links.has(x.exerciseId)));
  if (loggable.length === 0) return { kind: 'unavailable', reason: 'no_links' };

  const row = await supabase.from('profiles').select('equipment, goal, training_level').eq('id', input.userId).single();
  const p = row.data as { equipment?: unknown; goal?: unknown; training_level?: unknown } | null;
  if (row.error || !p || !EQUIPMENT.includes(p.equipment as Equipment) || !GOALS.includes(p.goal as Goal) || !LEVELS.includes(p.training_level as Level)) return UNREADABLE;
  const equipment = p.equipment as Equipment;
  return {
    kind: 'choose',
    catalogue: { exercises, sessions: loggable },
    profile: { equipment, location: equipment === 'gym' ? 'gym' : 'home', goal: p.goal as Goal, level: p.training_level as Level },
  };
}
