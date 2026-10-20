// Removes temporary food photos. Deploy with:
//   npx supabase functions deploy food-photo-cleanup --project-ref <ref> --no-verify-jwt --use-api
// Called only by the scheduled job (pg_cron through pg_net) with the shared secret, set as the function secret
// FOOD_PHOTO_CLEANUP_SECRET and as the Vault secret "food_photo_cleanup_secret". Without the secret, or when the secret
// is not configured, every request is refused. It deletes files through the Storage API; it never reads or logs a photo.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { runPhotoCleanup } from '../_shared/food/photo/lifecycle.ts';

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

// Compares without stopping at the first different character.
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('FOOD_PHOTO_CLEANUP_SECRET');
  const given = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || secret.length < 32 || !sameSecret(given, secret)) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { deleted } = await runPhotoCleanup(admin);
    return json({ deleted }, 200);
  } catch {
    return json({ error: 'Could not complete that' }, 500);
  }
});
