// Issues a short-lived, one-use opaque token for a rewarded ad. The app passes it to AdMob as SSV
// custom_data; the verified callback (grant-ad-reward) later redeems it. Deploy with:
//   npx supabase functions deploy request-ad-reward --project-ref <ref> --no-verify-jwt --use-api
// The JWT is verified here and the user comes only from it. The raw token is returned once and only its
// SHA-256 is stored.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sha256Hex } from '../_shared/ads/handler.ts';

const TOKEN_TTL_SECONDS = 15 * 60;

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

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const rewardType = body?.rewardType;
  if (rewardType !== 'food' && rewardType !== 'ai') return json({ error: 'invalid_reward_type' }, 400);

  const token = newToken();
  const { data: outcome, error: rpcError } = await admin.rpc('request_ad_reward', {
    p_user_id: data.user.id,
    p_reward_type: rewardType,
    p_token_hash: await sha256Hex(token),
    p_ttl_seconds: TOKEN_TTL_SECONDS,
  });
  if (rpcError) return json({ error: 'request_failed' }, 500);
  if (outcome === 'premium') return json({ error: 'premium_no_ads' }, 409);
  if (outcome === 'cap_reached') return json({ error: 'ad_cap_reached' }, 429);

  return json({ token, expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString() }, 200);
});
