// Maps one RevenueCat webhook body to the access changes it justifies. Pure: no I/O, no clock.
// The rule throughout is "uncertain never grants": anything unsupported, malformed, anonymous, for another
// entitlement or without a usable expiry produces no grant. Ordering and idempotency are enforced later,
// in Postgres (apply_billing_effect), because they need the stored per-user state.
export interface BillingEffect {
  userId: string;
  effect: 'grant' | 'revoke';
  untilMs: number | null; // grant only: null means lifetime
}

export interface MapOptions {
  now: number;
  entitlementId?: string; // when set, grants must name this entitlement
  acceptSandbox: boolean;
}

export type MapResult =
  | { status: 'invalid' }
  | { status: 'ignored'; reason: string }
  | { status: 'effects'; eventId: string; eventType: string; eventMs: number; effects: BillingEffect[]; reconcile: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRANT_TYPES = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED', 'REFUND_REVERSED', 'NON_RENEWING_PURCHASE']);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const userIds = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && UUID.test(v)).map((v) => v.toLowerCase()) : []);

export function mapRevenueCatEvent(body: unknown, options: MapOptions): MapResult {
  const event = isRecord(body) ? body.event : undefined;
  if (!isRecord(event)) return { status: 'invalid' };
  const { id, type } = event;
  const eventMs = event.event_timestamp_ms;
  if (typeof id !== 'string' || id === '' || typeof type !== 'string' || typeof eventMs !== 'number' || !Number.isInteger(eventMs) || eventMs <= 0) {
    return { status: 'invalid' };
  }
  const base = { eventId: id, eventType: type, eventMs };

  if (event.environment === 'SANDBOX' && !options.acceptSandbox) return { status: 'ignored', reason: 'sandbox_not_accepted' };

  if (type === 'TRANSFER') {
    // The destination's expiry is not in the event; the caller must confirm it with RevenueCat.
    const from = userIds(event.transferred_from);
    return {
      status: 'effects',
      ...base,
      effects: from.map((userId) => ({ userId, effect: 'revoke' as const, untilMs: null })),
      reconcile: userIds(event.transferred_to),
    };
  }

  const isGrant = GRANT_TYPES.has(type);
  const isRefund = type === 'CANCELLATION' && event.cancel_reason === 'CUSTOMER_SUPPORT';
  const isRevoke = type === 'EXPIRATION' || isRefund;
  if (type === 'CANCELLATION' && !isRefund) return { status: 'ignored', reason: 'cancellation_keeps_access' };
  if (!isGrant && !isRevoke) return { status: 'ignored', reason: 'unsupported_type' };

  const appUserId = event.app_user_id;
  if (typeof appUserId !== 'string' || !UUID.test(appUserId)) return { status: 'ignored', reason: 'no_user' };
  const userId = appUserId.toLowerCase();

  if (isRevoke) {
    // An event that explicitly lists only other entitlements says nothing about ours. A missing or empty
    // list still revokes: when unsure, access is withdrawn, never granted.
    const ids = event.entitlement_ids;
    if (options.entitlementId && Array.isArray(ids) && ids.length > 0 && !ids.includes(options.entitlementId)) {
      return { status: 'ignored', reason: 'entitlement_mismatch' };
    }
    return { status: 'effects', ...base, effects: [{ userId, effect: 'revoke', untilMs: null }], reconcile: [] };
  }

  if (options.entitlementId) {
    const ids = event.entitlement_ids;
    if (!Array.isArray(ids) || !ids.includes(options.entitlementId)) return { status: 'ignored', reason: 'entitlement_mismatch' };
  }

  const expiry = event.expiration_at_ms;
  if (expiry === null || expiry === undefined) {
    // Only a non-renewing purchase may be open-ended (lifetime); a subscription with no expiry is unusable.
    if (type !== 'NON_RENEWING_PURCHASE') return { status: 'invalid' };
    return { status: 'effects', ...base, effects: [{ userId, effect: 'grant', untilMs: null }], reconcile: [] };
  }
  if (typeof expiry !== 'number' || !Number.isInteger(expiry) || expiry <= 0) return { status: 'invalid' };
  return { status: 'effects', ...base, effects: [{ userId, effect: 'grant', untilMs: expiry }], reconcile: [] };
}
