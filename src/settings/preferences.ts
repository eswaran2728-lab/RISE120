import { supabase } from '../lib/supabase';

type ProfilePreference = { language: 'en' | 'ms' | 'ta' } | { units: 'metric' | 'imperial' };

export async function updateProfilePreference(userId: string, preference: ProfilePreference): Promise<void> {
  const { error } = await supabase.from('profiles').update(preference).eq('id', userId);
  if (error) throw new Error(error.message);
}
