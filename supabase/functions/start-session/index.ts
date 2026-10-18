// Starts (or resumes) today's workout session from a published template. Deploy with:
//   npx supabase functions deploy start-session --project-ref <ref> --no-verify-jwt --use-api
// The JWT is verified here and the account comes only from it. The database function checks the plan, the day,
// the member's access and the template, stores an immutable snapshot, and answers the same session to a repeat
// of the same request id.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseStartSessionRequest } from '../_shared/workout/session.ts';

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
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'Unauthorized' }, 401);

  const request = parseStartSessionRequest(await req.json().catch(() => null));
  if (!request.ok) return json({ error: 'invalid_request' }, 400);

  const { data, error } = await admin.rpc('start_workout_session', {
    p_user_id: auth.user.id,
    p_request_id: request.requestId,
    p_plan_id: request.planId,
    p_day_number: request.dayNumber,
    p_template_id: request.templateId,
    p_template_version: request.templateVersion,
  });
  if (error) {
    const text = `${error.message ?? ''}`;
    if (text.includes('PLAN_NOT_FOUND')) return json({ error: 'PLAN_NOT_FOUND' }, 404);
    if (text.includes('TEMPLATE_UNAVAILABLE')) return json({ error: 'TEMPLATE_UNAVAILABLE' }, 404);
    if (text.includes('DAY_NOT_AVAILABLE')) return json({ error: 'DAY_NOT_AVAILABLE' }, 409);
    return json({ error: 'Could not start the session' }, 500);
  }
  const row = data?.[0];
  if (!row) return json({ error: 'Could not start the session' }, 500);

  return json({ sessionId: row.result_session_id, status: row.result_status, snapshot: row.result_snapshot }, 200);
});
