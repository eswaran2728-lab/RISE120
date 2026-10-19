// Restricted moderation of buddy reports. Deploy with:
//   npx supabase functions deploy buddy-moderation --project-ref <ref> --no-verify-jwt --use-api
// There is no screen for this in the app and ordinary members get exactly the answer an unknown endpoint gives
// (404 not_found) for every action. Only an account named in buddy_moderators is served; the JWT is verified here and
// the account comes only from it. Moderators see a report and the names involved, never account ids or private data.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseModerationRequest } from '../_shared/buddy/moderation.ts';

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

const notFound = () => json({ error: 'not_found' }, 404);

function failure(message: string | undefined): Response {
  if (message?.includes('NOT_AUTHORISED')) return notFound();
  if (message?.includes('REPORT_NOT_FOUND')) return json({ error: 'REPORT_NOT_FOUND' }, 404);
  if (message?.includes('REPORT_CLOSED')) return json({ error: 'REPORT_CLOSED' }, 409);
  return json({ error: 'Could not complete that' }, 500);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !auth.user) return json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.id;

  // Not a moderator: the same answer whatever was asked, so the endpoint reveals nothing.
  const { data: moderator } = await admin.from('buddy_moderators').select('user_id').eq('user_id', userId).maybeSingle();
  if (!moderator) return notFound();

  const request = parseModerationRequest(await req.json().catch(() => null));
  if (!request.ok) return json({ error: 'invalid_request' }, 400);

  switch (request.action) {
    case 'queue': {
      const { data, error } = await admin.rpc('buddy_moderation_queue', { p_user_id: userId });
      if (error) return failure(error.message);
      const reports = (data ?? []).map((r: Record<string, unknown>) => ({
        reportId: r.result_id,
        status: r.result_status,
        reason: r.result_reason,
        note: r.result_note,
        createdAt: r.result_created_at,
        groupName: r.result_group_name,
        reporterDisplayName: r.result_reporter_name,
        reportedDisplayName: r.result_reported_name,
        reportedStillInGroup: r.result_reported_in_group,
      }));
      return json({ reports }, 200);
    }
    case 'start_review': {
      const { error } = await admin.rpc('buddy_moderation_start_review', { p_user_id: userId, p_report_id: request.reportId });
      return error ? failure(error.message) : json({ inReview: true }, 200);
    }
    case 'resolve': {
      const { error } = await admin.rpc('buddy_moderation_resolve', { p_user_id: userId, p_report_id: request.reportId, p_resolution: request.resolution, p_note: request.note });
      return error ? failure(error.message) : json({ closed: true }, 200);
    }
  }
});
