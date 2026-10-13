import { supabase } from '../lib/supabase';
import { OnboardingDraft } from './draft';
import { validateBody } from './validation';

// Safe to repeat: the upsert targets the profile id, and onboarded_at is only
// written while it is still null, so a retry never creates a second row or
// moves the original onboarding time. The caller clears the draft after success.
export async function submitProfile(userId: string, draft: OnboardingDraft): Promise<void> {
  const { age, heightCm, weightKg } = draft;
  const body = validateBody({ age, heightCm, weightKg });
  if (!body.ok) {
    throw new Error(`Invalid ${body.field}: ${body.reason}`);
  }

  const { error: upsertError } = await supabase.from('profiles').upsert(
    {
      id: userId,
      age,
      height_cm: heightCm,
      weight_kg: weightKg,
      goal: draft.goal,
      training_level: draft.trainingLevel,
      equipment: draft.equipment,
      food_preferences: draft.foodPreferences,
      language: draft.language,
      units: draft.units,
      energy_sex: draft.energySex,
      activity_level: draft.activityLevel,
    },
    { onConflict: 'id' }
  );
  if (upsertError) throw new Error(upsertError.message);

  const { error: onboardedError } = await supabase
    .from('profiles')
    .update({ onboarded_at: new Date().toISOString() })
    .eq('id', userId)
    .is('onboarded_at', null);
  if (onboardedError) throw new Error(onboardedError.message);
}
