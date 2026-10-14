// The grant-ad-reward callback logic, free of Deno and Supabase so it can be tested with signed fixtures.
// Only a callback whose Google signature verifies, from one of our own ad units, reaches the ledger.
import { KeyLookup, verifyRewardCallback } from './ssv.ts';

export type GrantOutcome = 'granted' | 'duplicate' | 'unknown_token' | 'token_used' | 'expired' | 'cap_reached' | 'premium';

export interface GrantCall {
  tokenHash: string;
  transactionId: string;
  adUnit: string;
}

export interface CallbackDeps {
  keys: KeyLookup;
  adUnitIds: string[]; // our rewarded ad units (full "ca-app-pub-…/123" or bare "123")
  grant(call: GrantCall): Promise<GrantOutcome>;
}

export interface CallbackResponse {
  status: number;
  body: Record<string, unknown>;
}

// Google signs callbacks for every AdMob publisher, so a valid signature alone proves nothing about whose ad
// was watched. The ad unit must be ours, otherwise anyone could earn credits from their own AdMob account.
const bareUnit = (id: string) => id.slice(id.lastIndexOf('/') + 1).trim();

export async function handleAdRewardCallback(rawQuery: string, deps: CallbackDeps): Promise<CallbackResponse> {
  const allowed = deps.adUnitIds.map(bareUnit).filter((id) => id !== '');
  if (allowed.length === 0) return { status: 503, body: { error: 'not_configured' } };

  let verified;
  try {
    verified = await verifyRewardCallback(rawQuery, deps.keys);
  } catch {
    return { status: 503, body: { error: 'keys_unavailable' } };
  }
  if (!verified.ok) {
    return verified.reason === 'malformed' ? { status: 400, body: { error: 'malformed' } } : { status: 403, body: { error: verified.reason } };
  }

  const { custom_data: token, transaction_id: transactionId, ad_unit: adUnit } = verified.params;
  if (!adUnit || !allowed.includes(bareUnit(adUnit))) return { status: 403, body: { error: 'ad_unit_not_allowed' } };
  if (!token || !transactionId) return { status: 400, body: { error: 'missing_fields' } };

  try {
    const outcome = await deps.grant({ tokenHash: await sha256Hex(token), transactionId, adUnit: bareUnit(adUnit) });
    return { status: 200, body: { ok: true, outcome } };
  } catch {
    // Non-200 makes Google retry; the ledger is idempotent by token and transaction id.
    return { status: 500, body: { error: 'grant_failed' } };
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
