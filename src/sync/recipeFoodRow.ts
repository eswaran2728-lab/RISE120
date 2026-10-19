import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecipeFoodOperation } from './types';

// Creates the member's private food for a reviewed recipe version, and returns the id the server holds it under.
// Safe to repeat: a retry (or a lost response) finds the food it already made, and a food that was created earlier
// under another id (for example from another phone) is reused instead of duplicated. Whatever the queued snapshot
// says, the row is always private to this member and unverified; a recipe food is never shared and never verified.
export async function createRecipeFood(client: SupabaseClient, userId: string, op: RecipeFoodOperation): Promise<string> {
  const food = op.food;
  if (food.source !== 'recipe' || !food.sourceId || food.id !== op.id) throw new Error('Not a recipe food');
  const { error } = await client.from('foods').upsert(
    {
      id: op.id,
      user_id: userId,
      name: food.name,
      aliases: food.aliases,
      serving_desc: food.servingDesc,
      calories: food.calories,
      protein_g: food.proteinG,
      carbs_g: food.carbsG,
      fat_g: food.fatG,
      source: 'recipe',
      source_id: food.sourceId,
      verified: false,
      region: food.region,
    },
    { onConflict: 'id', ignoreDuplicates: true }
  );
  // 23505: this member already has a food for that recipe version under another id; the lookup below finds it.
  if (error && error.code !== '23505') throw new Error(error.message);

  const found = await client.from('foods').select('id').eq('user_id', userId).eq('source', 'recipe').eq('source_id', food.sourceId).maybeSingle();
  if (found.error || !found.data) throw new Error(found.error?.message ?? 'Recipe food was not created');
  return (found.data as { id: string }).id;
}
