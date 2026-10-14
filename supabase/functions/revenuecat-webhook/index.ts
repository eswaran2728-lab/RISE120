// RevenueCat webhook: the only path that changes premium access from a purchase. Deploy with:
//   npx supabase functions deploy revenuecat-webhook --project-ref <ref> --no-verify-jwt --use-api
// (no Supabase JWT: RevenueCat authenticates with the Authorization header value you configure in its
// dashboard). Supabase secrets, never Git:
//   REVENUECAT_WEBHOOK_AUTH   exact Authorization header value RevenueCat will send (required)
//   REVENUECAT_ENTITLEMENT_ID entitlement id that means premium (recommended)
//   REVENUECAT_API_KEY        secret API key, only used to confirm entitlements after a TRANSFER (optional)
//   REVENUECAT_ACCEPT_SANDBOX 'true' to honour sandbox purchases (development only)
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleRevenueCatWebhook } from '../_shared/billing/handler.ts';
import { confirmEntitlement } from '../_shared/billing/subscriber.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  const entitlementId = Deno.env.get('REVENUECAT_ENTITLEMENT_ID') || undefined;
  const apiKey = Deno.env.get('REVENUECAT_API_KEY');

  const result = await handleRevenueCatWebhook(
    { method: req.method, header: (name) => req.headers.get(name), text: () => req.text() },
    {
      secret: Deno.env.get('REVENUECAT_WEBHOOK_AUTH') || undefined,
      options: { now: Date.now(), entitlementId, acceptSandbox: Deno.env.get('REVENUECAT_ACCEPT_SANDBOX') === 'true' },
      apply: async (call) => {
        const { data, error } = await admin.rpc('apply_billing_effect', {
          p_event_id: call.eventId,
          p_event_type: call.eventType,
          p_event_ms: call.eventMs,
          p_user_id: call.userId,
          p_effect: call.effect,
          p_until_ms: call.untilMs,
        });
        if (error) throw new Error('apply_failed');
        return data;
      },
      reconcile: async (userId) => (apiKey && entitlementId ? await confirmEntitlement(fetch, apiKey, userId, entitlementId, Date.now()) : null),
    }
  );

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
});
