// Authenticated limit read model: what the signed-in user may still do today. Deploy with:
//   npx supabase functions deploy check-limit --project-ref <ref> --no-verify-jwt --use-api
// The JWT is verified here (like the other functions) and the user id comes only from it. All numbers
// come from server tables; the app displays them and never decides authorization. A missing or invalid
// limit in app_config fails closed with a 500 rather than guessing.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { loadLimitSnapshot } from '../_shared/limits/read.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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

  const result = await loadLimitSnapshot(admin, data.user.id);
  if (!result.ok) return json({ error: result.reason === 'config' ? 'limit_config_invalid' : 'limit_read_failed' }, 500);
  return json({ ...result.snapshot }, 200);
});
