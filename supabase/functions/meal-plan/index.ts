// Saves the member meal plan. Deploy with:
//   npx supabase functions deploy meal-plan --project-ref <ref> --no-verify-jwt --use-api
// The JWT is verified here and the account comes only from it. The database function enforces premium (on database
// time), the revision the edit was made against, one answer per request id, and that every selection is a published
// reviewed recipe. Saving never creates food logs.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseSaveMealPlanRequest } from '../_shared/food/mealPlan.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'Unauthorized' }, 401);

  const request = parseSaveMealPlanRequest(await req.json().catch(() => null));
  if (!request.ok) return json({ error: 'invalid_request' }, 400);

  const { data, error } = await admin.rpc('save_meal_plan', {
    p_user_id: auth.user.id,
    p_request_id: request.requestId,
    p_expected_revision: request.expectedRevision,
    p_selections: request.selections,
  });
  if (error) {
    const text = `${error.message ?? ''}`;
    const conflict = /REVISION_CONFLICT:(\d+)/.exec(text);
    if (conflict) return json({ error: 'REVISION_CONFLICT', revision: Number(conflict[1]) }, 409);
    if (text.includes('PREMIUM_REQUIRED')) return json({ error: 'PREMIUM_REQUIRED' }, 402);
    if (text.includes('RECIPE_UNAVAILABLE')) return json({ error: 'RECIPE_UNAVAILABLE' }, 422);
    if (text.includes('INVALID_SELECTIONS')) return json({ error: 'invalid_request' }, 400);
    return json({ error: 'Could not save the meal plan' }, 500);
  }
  const row = data?.[0];
  if (!row) return json({ error: 'Could not save the meal plan' }, 500);
  return json({ status: row.result_status, revision: row.result_revision, selections: row.result_selections }, 200);
});
