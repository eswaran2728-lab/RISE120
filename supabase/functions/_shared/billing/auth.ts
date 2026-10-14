// Checks the Authorization header RevenueCat sends against the value configured in Supabase secrets.
// Constant-time over the full length, and closed when nothing is configured.
export function isAuthorized(header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || typeof header !== 'string') return false;
  const a = new TextEncoder().encode(header);
  const b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
