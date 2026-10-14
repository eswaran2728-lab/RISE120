// AdMob rewarded-ad server-side-verification callback. Google calls this with a plain GET (no Supabase JWT),
// so it is deployed with --no-verify-jwt and trusts nothing but Google's signature. Deploy with:
//   npx supabase functions deploy grant-ad-reward --project-ref <ref> --no-verify-jwt --use-api
// Supabase secret (never Git): ADMOB_REWARDED_AD_UNIT_IDS = comma-separated list of OUR rewarded ad unit ids.
// In AdMob, set the ad unit's SSV callback URL to  https://<project-ref>.supabase.co/functions/v1/grant-ad-reward
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createKeyProvider } from '../_shared/ads/keys.ts';
import { handleAdRewardCallback } from '../_shared/ads/handler.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Cached per instance; Google asks for no more than 24 hours, so 1 hour with throttled rotation refreshes.
const keys = createKeyProvider({ fetcher: (url) => fetch(url), now: () => Date.now(), ttlMs: 60 * 60 * 1000, minRefetchMs: 60 * 1000 });

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });

  // The signature covers the raw query exactly as Google sent it, so it is taken from the URL untouched.
  const rawQuery = new URL(req.url).search;
  const adUnitIds = (Deno.env.get('ADMOB_REWARDED_AD_UNIT_IDS') ?? '').split(',').map((id) => id.trim()).filter(Boolean);

  const result = await handleAdRewardCallback(rawQuery, {
    keys,
    adUnitIds,
    grant: async (call) => {
      const { data, error } = await admin.rpc('grant_ad_reward', {
        p_token_hash: call.tokenHash,
        p_transaction_id: call.transactionId,
        p_ad_unit: call.adUnit,
      });
      if (error) throw new Error('grant_failed');
      return data;
    },
  });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
});
