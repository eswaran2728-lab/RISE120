import { supabase } from '../lib/supabase';

export type EnergySex = 'male' | 'female' | 'undisclosed';
export type ActivityLevel = 'sedentary' | 'light' | 'active';

export async function savePlanInputs(
  userId: string,
  input: { energySex: EnergySex; activityLevel: ActivityLevel }
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ energy_sex: input.energySex, activity_level: input.activityLevel })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}
