// Authenticated AI coach. POST { requestId: UUID, message: string }. Deploy with:
//   npx supabase functions deploy ai-coach --project-ref <ref> --no-verify-jwt --use-api
// The JWT is verified here and the account comes only from it. The AI allowance is enforced by the database
// ledger (reserve / finish / fail); this function never decides a quota and never writes a plan day.
// Supabase secrets (never Git): GEMINI_API_KEY and GEMINI_MODEL. Without both the function answers 503
// COACH_UNAVAILABLE after releasing the reservation, so nothing is charged. Health details are never logged.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { loadCoachContext } from '../_shared/coach/context.ts';
import { createGeminiProvider } from '../_shared/coach/gemini.ts';
import { handleCoachRequest } from '../_shared/coach/handler.ts';
import { createLedger } from '../_shared/coach/ledger.ts';
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
  const userId = data.user.id;

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  const model = Deno.env.get('GEMINI_MODEL');
  const body = await req.json().catch(() => undefined);

  const result = await handleCoachRequest(
    { userId, body },
    {
      ledger: createLedger(admin),
      loadContext: (id) => loadCoachContext(admin, id),
      provider: apiKey && model ? createGeminiProvider({ apiKey, model }) : null,
      loadQuota: async (id) => {
        const snapshot = await loadLimitSnapshot(admin, id);
        return snapshot.ok ? { used: snapshot.snapshot.ai.used, remaining: snapshot.snapshot.ai.remaining, resetsAt: snapshot.snapshot.resetsAt } : null;
      },
    }
  );
  const response = json(result.body, result.status);
  // Tell well-behaved clients when to come back, from the server's own clock.
  const retryAt = typeof result.body.retryAt === 'string' ? Date.parse(result.body.retryAt) : NaN;
  if (result.status === 429 && Number.isFinite(retryAt)) response.headers.set('Retry-After', String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))));
  return response;
});
