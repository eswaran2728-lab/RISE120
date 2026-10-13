import { supabase } from '../lib/supabase';
import type { LocalDate } from '../sync/types';

// Asks the server to build the signed-in user's 120-day plan. The server reads the profile, so
// only the local start date is sent. Safe to repeat.
export async function generatePlan(startDate: LocalDate): Promise<void> {
  const { error } = await supabase.functions.invoke('generate-plan', { method: 'POST', body: { startDate } });
  if (error) throw new Error(error.message);
}
