// Accept or decline a stored coach proposal. POST { proposalId: UUID, decision: 'accept' | 'decline' }. Deploy with:
//   npx supabase functions deploy decide-coach-proposal --project-ref <ref> --no-verify-jwt --use-api
// The JWT is verified here and the account comes only from it. The request carries no plan content: the database
// decides from the stored patch, in one transaction, applying every day or none (see the coach_proposal_decision
// migration). This function never writes a plan day itself.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleDecision } from '../_shared/coach/decide.ts';

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

  const body = await req.json().catch(() => undefined);
  const result = await handleDecision(
    { userId: data.user.id, body },
    {
      decide: async (userId, proposalId, decision) => {
        const { data: out, error: rpcError } = await admin.rpc('coach_decide_proposal', {
          p_user_id: userId,
          p_proposal_id: proposalId,
          p_decision: decision,
        });
        if (rpcError || !out) throw new Error('decide_failed');
        return { ...out, changedDays: out.changed_days };
      },
    }
  );
  return json(result.body, result.status);
});
