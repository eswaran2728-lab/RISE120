// Private buddy groups. Deploy with:
//   npx supabase functions deploy buddy --project-ref <ref> --no-verify-jwt --use-api
// One endpoint, several actions. The JWT is verified here and the account comes only from it. Group content a
// member can see is limited to display names and the days a workout was logged (see the migration). Invitation
// tokens are generated here, returned once, and stored only as a SHA-256 hash.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sha256Hex } from '../_shared/ads/handler.ts';
import { DISCLOSURE_VERSION, parseBuddyRequest } from '../_shared/buddy/request.ts';

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

const ERRORS: Record<string, number> = {
  GROUP_NOT_FOUND: 404,
  MEMBER_NOT_FOUND: 404,
  INVITE_NOT_FOUND: 404,
  INVITE_UNAVAILABLE: 404,
  NOT_OWNER: 403,
  LIMIT_REACHED: 409,
  GROUP_FULL: 409,
  ALREADY_MEMBER: 409,
  INVALID_TARGET: 409,
};

function failure(message: string | undefined): Response {
  for (const [code, status] of Object.entries(ERRORS)) {
    if (message?.includes(code)) return json({ error: code }, status);
  }
  return json({ error: 'Could not complete that' }, 500);
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
  const { data: auth, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !auth.user) return json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.id;

  const request = parseBuddyRequest(await req.json().catch(() => null));
  if (!request.ok) return json({ error: 'invalid_request' }, 400);

  switch (request.action) {
    case 'create_group': {
      const { data, error } = await admin.rpc('buddy_create_group', { p_user_id: userId, p_name: request.name, p_display_name: request.displayName, p_disclosure_version: DISCLOSURE_VERSION });
      return error ? failure(error.message) : json({ groupId: data }, 200);
    }
    case 'create_invite': {
      const token = newToken();
      const { data, error } = await admin.rpc('buddy_create_invite', { p_user_id: userId, p_group_id: request.groupId, p_token_hash: await sha256Hex(token) });
      if (error) return failure(error.message);
      const row = data?.[0];
      return row ? json({ token, inviteId: row.result_invite_id, expiresAt: row.result_expires_at }, 200) : json({ error: 'Could not complete that' }, 500);
    }
    case 'revoke_invite': {
      const { error } = await admin.rpc('buddy_revoke_invite', { p_user_id: userId, p_invite_id: request.inviteId });
      return error ? failure(error.message) : json({ revoked: true }, 200);
    }
    case 'accept_invite': {
      const { data, error } = await admin.rpc('buddy_accept_invite', {
        p_user_id: userId,
        p_token_hash: await sha256Hex(request.token),
        p_display_name: request.displayName,
        p_disclosure_version: DISCLOSURE_VERSION,
      });
      return error ? failure(error.message) : json({ groupId: data }, 200);
    }
    case 'leave': {
      const { error } = await admin.rpc('buddy_leave', { p_user_id: userId, p_group_id: request.groupId });
      return error ? failure(error.message) : json({ left: true }, 200);
    }
    case 'remove_member': {
      const { error } = await admin.rpc('buddy_remove_member', { p_user_id: userId, p_group_id: request.groupId, p_member_id: request.memberId });
      return error ? failure(error.message) : json({ removed: true }, 200);
    }
    case 'block_member': {
      const { error } = await admin.rpc('buddy_block_member', { p_user_id: userId, p_group_id: request.groupId, p_member_id: request.memberId });
      return error ? failure(error.message) : json({ blocked: true }, 200);
    }
    case 'summary': {
      const { data, error } = await admin.rpc('buddy_summary', { p_user_id: userId, p_group_id: request.groupId, p_from: request.from, p_to: request.to });
      if (error) return failure(error.message);
      const members = (data ?? []).map((row: { result_member_id: string; result_display_name: string; result_days: string[] }) => ({
        memberId: row.result_member_id,
        displayName: row.result_display_name,
        days: row.result_days,
      }));
      return json({ members }, 200);
    }
  }
});
