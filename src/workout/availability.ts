// What the swap list needs to know that the session itself does not say: the equipment this member has, where the
// session happens, and which logged-set exercise each catalogue exercise corresponds to. Anything unreadable
// gives null, so a screen never guesses equipment and offers a swap that cannot be done.
import { supabase } from '../lib/supabase';
import type { Equipment } from './catalogue';
import type { Availability } from './swaps';

const EQUIPMENT: Equipment[] = ['gym', 'home', 'none'];

export async function loadAvailability(userId: string, sessionId: string): Promise<Availability | null> {
  const profile = await supabase.from('profiles').select('equipment').eq('id', userId).single();
  const session = await supabase.from('workout_sessions').select('snapshot').eq('id', sessionId).single();
  if (profile.error || session.error) return null;
  const equipment = (profile.data as { equipment?: unknown } | null)?.equipment;
  const location = ((session.data as { snapshot?: { location?: unknown } } | null)?.snapshot ?? {}).location;
  if (!EQUIPMENT.includes(equipment as Equipment) || (location !== 'home' && location !== 'gym')) return null;
  return { equipment: equipment as Equipment, location };
}

export async function loadExerciseLinks(): Promise<Map<string, string> | null> {
  const { data, error } = await supabase.from('exercise_links').select('catalogue_id, exercise_id');
  if (error || !Array.isArray(data)) return null;
  return new Map((data as { catalogue_id: string; exercise_id: string }[]).map((row) => [row.catalogue_id, row.exercise_id]));
}
