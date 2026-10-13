// Authenticated USDA FoodData Central search. Deploy with:
//   npx supabase functions deploy search-foods --project-ref <ref> --no-verify-jwt --use-api
// Secret (set with `npx supabase secrets set USDA_FDC_API_KEY=...`, never in the app or git):
//   USDA_FDC_API_KEY
// The JWT is verified here (like the other functions); results are unverified previews.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleSearchFoods } from '../_shared/food/handler.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const result = await handleSearchFoods(body, { apiKey: Deno.env.get('USDA_FDC_API_KEY'), fetchFn: fetch });
  return json(result.body, result.status);
});
