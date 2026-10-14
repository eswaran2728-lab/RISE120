// Confirms a user's current entitlement with RevenueCat's subscriber API. Used only after a TRANSFER,
// whose event does not say what the destination now holds. Anything unconfirmed returns null (no grant).
type Fetcher = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

export async function confirmEntitlement(
  fetcher: Fetcher,
  apiKey: string,
  userId: string,
  entitlementId: string,
  now: number
): Promise<{ untilMs: number | null } | null> {
  const response = await fetcher(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('subscriber_lookup_failed');

  const body = (await response.json()) as { subscriber?: { entitlements?: Record<string, { expires_date?: string | null }> } };
  const entitlement = body?.subscriber?.entitlements?.[entitlementId];
  if (!entitlement) return null;
  if (entitlement.expires_date === null) return { untilMs: null };
  const untilMs = typeof entitlement.expires_date === 'string' ? Date.parse(entitlement.expires_date) : NaN;
  return Number.isFinite(untilMs) && untilMs > now ? { untilMs } : null;
}
