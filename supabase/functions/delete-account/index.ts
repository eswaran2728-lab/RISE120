// Deletes the calling user's auth user (and, through cascades, all their rows).
// Deploy with: npx supabase functions deploy delete-account --no-verify-jwt
// The JWT is verified here, and the user id comes only from it, never from the body.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

  // Remove the user's private photos first: Storage objects are not removed by the
  // database cascade, and the auth user cannot be deleted while it still owns objects. If this
  // fails we stop before deleting the user, so a retry can finish the job.
  const userId = data.user.id;
  // Both private photo buckets: check-in photos and temporary food photos.
  for (const bucket of ['checkin-photos', 'food-photos']) {
    const photos = admin.storage.from(bucket);
    for (;;) {
      const { data: files, error: listError } = await photos.list(userId, { limit: 1000 });
      if (listError) return json({ error: 'Could not delete account' }, 500);
      if (!files || files.length === 0) break;
      const { error: removeError } = await photos.remove(files.map((file) => `${userId}/${file.name}`));
      if (removeError) return json({ error: 'Could not delete account' }, 500);
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) return json({ error: 'Could not delete account' }, 500);

  return json({ deleted: true }, 200);
});
