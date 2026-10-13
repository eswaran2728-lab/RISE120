// Authenticated, READ-ONLY Open Food Facts barcode lookup. Deploy with:
//   npx supabase functions deploy lookup-barcode --project-ref <ref> --no-verify-jwt --use-api
// Configuration (Supabase secret, not in the app or git): OFF_CONTACT, a real contact email or URL
// that Open Food Facts can reach, used in the User-Agent. Without it the function answers 503.
// Nothing returned here is stored: durable use of Open Food Facts data needs the owner's reuse decision.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleBarcodeLookup } from '../_shared/food/barcodeHandler.ts';

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
  const result = await handleBarcodeLookup(body, { contact: Deno.env.get('OFF_CONTACT'), fetchFn: fetch });
  return json(result.body, result.status);
});
