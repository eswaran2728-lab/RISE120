// Swaps the remaining sets of one exercise in a started session, and finishes a session. Deploy with:
//   npx supabase functions deploy session-actions --project-ref <ref> --no-verify-jwt --use-api
// The JWT is verified here and the account comes only from it. The database does the work: it checks ownership,
// the revision, the reviewed alternatives and the equipment, never changes a logged set, and completes a session
// exactly once.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseSessionActionRequest } from '../_shared/workout/actions.ts';

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

const REFUSED: Record<string, number> = {
  SESSION_NOT_FOUND: 404,
  SESSION_COMPLETED: 409,
  NOTHING_LOGGED: 409,
  EXERCISE_NOT_IN_SESSION: 422,
  NOTHING_TO_SWAP: 422,
  REPLACEMENT_UNAVAILABLE: 422,
  NOT_AN_ALTERNATIVE: 422,
  ALREADY_IN_SESSION: 422,
  EQUIPMENT_UNSUITABLE: 422,
};

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

  const request = parseSessionActionRequest(await req.json().catch(() => null));
  if (!request.ok) return json({ error: 'invalid_request' }, 400);

  if (request.action === 'complete') {
    const { data, error } = await admin.rpc('complete_workout_session', { p_user_id: auth.user.id, p_session_id: request.sessionId });
    if (error) return refusal(error.message, 'Could not complete the session');
    const row = data?.[0];
    if (!row) return json({ error: 'Could not complete the session' }, 500);
    return json({ status: row.result_status, summary: row.result_summary, completedAt: row.result_completed_at }, 200);
  }

  const { data, error } = await admin.rpc('swap_session_exercise', {
    p_user_id: auth.user.id,
    p_session_id: request.sessionId,
    p_request_id: request.requestId,
    p_expected_revision: request.expectedRevision,
    p_from: request.fromExerciseId,
    p_to: request.replacementId,
  });
  if (error) return refusal(error.message, 'Could not swap the exercise');
  const row = data?.[0];
  if (!row) return json({ error: 'Could not swap the exercise' }, 500);
  return json({ status: row.result_status, revision: row.result_revision, exercises: row.result_exercises }, 200);
});

function refusal(message: string | undefined, fallback: string): Response {
  const text = `${message ?? ''}`;
  const conflict = /REVISION_CONFLICT:(\d+)/.exec(text);
  if (conflict) return json({ error: 'REVISION_CONFLICT', revision: Number(conflict[1]) }, 409);
  const code = Object.keys(REFUSED).find((c) => text.includes(c));
  if (code) return json({ error: code }, REFUSED[code]);
  return json({ error: fallback }, 500);
}
