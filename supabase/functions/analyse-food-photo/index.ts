// Authenticated food-photo analysis. POST { requestId: UUID, privateImageRef: "<user id>/<request id>.jpg" }. Deploy with:
//   npx supabase functions deploy analyse-food-photo --project-ref <ref> --no-verify-jwt --use-api
// The JWT is verified here and the account comes only from it. The image must already be in the member's private
// food-photos folder. The answer is a bounded list of REFERENCES to existing sourced foods or published recipes with an
// uncertainty label; it never carries nutrition, and this function never writes a food log.
//
// No image provider is configured: `provider` below is null on purpose. Until F2 Task 4's gate (approved terms,
// retention, cost ceiling, operator) is met and an adapter is added, every request ends in a clear "unavailable" and the
// app falls back to manual food search. The provider kill switch (app_config food_photo_enabled) is also off.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createFoodPhotoDeps } from '../_shared/food/photo/deps.ts';
import { handleFoodPhotoRequest } from '../_shared/food/photo/handler.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
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

  const body = await req.json().catch(() => undefined);
  const result = await handleFoodPhotoRequest({ userId: data.user.id, body }, createFoodPhotoDeps(admin, null));

  const retryAt = typeof result.body.retryAt === 'string' ? Date.parse(result.body.retryAt) : NaN;
  const retryHeader = result.status === 429 && Number.isFinite(retryAt) ? { 'Retry-After': String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))) } : {};
  return json(result.body, result.status, retryHeader);
});
