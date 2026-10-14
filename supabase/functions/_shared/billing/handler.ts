// The webhook's request logic, kept free of Deno and Supabase so it can be tested directly.
import { isAuthorized } from './auth.ts';
import { BillingEffect, MapOptions, mapRevenueCatEvent } from './events.ts';

export interface WebhookRequest {
  method: string;
  header(name: string): string | null;
  text(): Promise<string>;
}

export interface ApplyCall extends BillingEffect {
  eventId: string;
  eventType: string;
  eventMs: number;
}

export type ApplyOutcome = 'applied' | 'duplicate' | 'stale' | 'unknown_user';

export interface WebhookDeps {
  secret: string | undefined;
  options: MapOptions;
  apply(call: ApplyCall): Promise<ApplyOutcome>;
  // Confirms a transfer destination's current entitlement with RevenueCat; null means "cannot confirm".
  reconcile(userId: string): Promise<{ untilMs: number | null } | null>;
}

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

export async function handleRevenueCatWebhook(req: WebhookRequest, deps: WebhookDeps): Promise<WebhookResponse> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
  if (!deps.secret) return { status: 503, body: { error: 'webhook_not_configured' } };
  if (!isAuthorized(req.header('authorization'), deps.secret)) return { status: 401, body: { error: 'unauthorized' } };

  let parsed: unknown;
  try {
    parsed = JSON.parse(await req.text());
  } catch {
    return { status: 400, body: { error: 'invalid_json' } };
  }

  const mapped = mapRevenueCatEvent(parsed, deps.options);
  if (mapped.status === 'invalid') return { status: 400, body: { error: 'invalid_event' } };
  if (mapped.status === 'ignored') return { status: 200, body: { ok: true, ignored: mapped.reason } };

  try {
    const calls: ApplyCall[] = mapped.effects.map((effect) => ({ eventId: mapped.eventId, eventType: mapped.eventType, eventMs: mapped.eventMs, ...effect }));
    for (const userId of mapped.reconcile) {
      const confirmed = await deps.reconcile(userId);
      if (confirmed) {
        calls.push({ eventId: mapped.eventId, eventType: mapped.eventType, eventMs: mapped.eventMs, userId, effect: 'grant', untilMs: confirmed.untilMs });
      }
    }
    const outcomes: ApplyOutcome[] = [];
    for (const call of calls) outcomes.push(await deps.apply(call));
    return { status: 200, body: { ok: true, outcomes } };
  } catch {
    // Non-200 makes RevenueCat retry; every step is idempotent by event id.
    return { status: 500, body: { error: 'apply_failed' } };
  }
}
