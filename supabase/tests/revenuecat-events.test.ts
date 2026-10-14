import { mapRevenueCatEvent } from '../functions/_shared/billing/events';
import { isAuthorized } from '../functions/_shared/billing/auth';
import { confirmEntitlement } from '../functions/_shared/billing/subscriber';
import { handleRevenueCatWebhook, WebhookDeps, WebhookRequest } from '../functions/_shared/billing/handler';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-10-14T12:00:00Z');
const DAY = 86400000;
const OPTS = { now: NOW, entitlementId: 'premium', acceptSandbox: false };

const event = (over: Record<string, unknown> = {}) => ({
  api_version: '1.0',
  event: {
    id: 'evt-1',
    type: 'INITIAL_PURCHASE',
    app_user_id: USER_A,
    event_timestamp_ms: NOW - 1000,
    purchased_at_ms: NOW - 1000,
    expiration_at_ms: NOW + 30 * DAY,
    entitlement_ids: ['premium'],
    environment: 'PRODUCTION',
    ...over,
  },
});

describe('mapRevenueCatEvent', () => {
  it.each(['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED', 'REFUND_REVERSED'])('grants until the expiration for %s', (type) => {
    const result = mapRevenueCatEvent(event({ type }), OPTS);

    expect(result).toMatchObject({ status: 'effects', eventId: 'evt-1', effects: [{ userId: USER_A, effect: 'grant', untilMs: NOW + 30 * DAY }] });
  });

  it('treats a non-renewing purchase without an expiry as lifetime access', () => {
    const result = mapRevenueCatEvent(event({ type: 'NON_RENEWING_PURCHASE', expiration_at_ms: null }), OPTS);

    expect(result).toMatchObject({ status: 'effects', effects: [{ userId: USER_A, effect: 'grant', untilMs: null }] });
  });

  it('never grants a subscription event that has no expiry', () => {
    expect(mapRevenueCatEvent(event({ type: 'RENEWAL', expiration_at_ms: null }), OPTS).status).toBe('invalid');
  });

  it('keeps access after a normal cancellation (it ends at expiration)', () => {
    const result = mapRevenueCatEvent(event({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE' }), OPTS);

    expect(result).toMatchObject({ status: 'ignored', reason: 'cancellation_keeps_access' });
  });

  it('revokes on a refund (cancellation by customer support)', () => {
    const result = mapRevenueCatEvent(event({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' }), OPTS);

    expect(result).toMatchObject({ status: 'effects', effects: [{ userId: USER_A, effect: 'revoke', untilMs: null }] });
  });

  it('revokes on expiration, even without an entitlement list', () => {
    const result = mapRevenueCatEvent(event({ type: 'EXPIRATION', entitlement_ids: null }), OPTS);

    expect(result).toMatchObject({ status: 'effects', effects: [{ userId: USER_A, effect: 'revoke' }] });
  });

  it('does not revoke on an expiration that lists only another entitlement', () => {
    const result = mapRevenueCatEvent(event({ type: 'EXPIRATION', entitlement_ids: ['other'] }), OPTS);

    expect(result).toMatchObject({ status: 'ignored', reason: 'entitlement_mismatch' });
  });

  it('does not revoke on a refund that lists only another entitlement', () => {
    const result = mapRevenueCatEvent(event({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', entitlement_ids: ['other'] }), OPTS);

    expect(result).toMatchObject({ status: 'ignored', reason: 'entitlement_mismatch' });
  });

  it('revokes when the expiration lists Rise120 premium among several entitlements', () => {
    const result = mapRevenueCatEvent(event({ type: 'EXPIRATION', entitlement_ids: ['other', 'premium'] }), OPTS);

    expect(result).toMatchObject({ status: 'effects', effects: [{ userId: USER_A, effect: 'revoke' }] });
  });

  it('still revokes when an expiration lists no entitlements at all (fail toward no access)', () => {
    expect(mapRevenueCatEvent(event({ type: 'EXPIRATION', entitlement_ids: [] }), OPTS)).toMatchObject({ status: 'effects' });
    expect(mapRevenueCatEvent(event({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', entitlement_ids: undefined }), OPTS)).toMatchObject({ status: 'effects' });
  });

  it.each(['BILLING_ISSUE', 'SUBSCRIPTION_PAUSED', 'TEST', 'PRODUCT_CHANGE', 'TEMPORARY_ENTITLEMENT_GRANT', 'SUBSCRIBER_ALIAS', 'SOMETHING_NEW'])(
    'never changes access for %s',
    (type) => {
      expect(mapRevenueCatEvent(event({ type }), OPTS)).toMatchObject({ status: 'ignored' });
    }
  );

  it('ignores anonymous and non-UUID app user ids', () => {
    expect(mapRevenueCatEvent(event({ app_user_id: '$RCAnonymousID:abc' }), OPTS)).toMatchObject({ status: 'ignored', reason: 'no_user' });
    expect(mapRevenueCatEvent(event({ app_user_id: 'not-a-uuid' }), OPTS)).toMatchObject({ status: 'ignored', reason: 'no_user' });
  });

  it('does not grant for another entitlement or when the entitlement is missing', () => {
    expect(mapRevenueCatEvent(event({ entitlement_ids: ['other'] }), OPTS)).toMatchObject({ status: 'ignored', reason: 'entitlement_mismatch' });
    expect(mapRevenueCatEvent(event({ entitlement_ids: null }), OPTS)).toMatchObject({ status: 'ignored', reason: 'entitlement_mismatch' });
  });

  it('rejects sandbox events unless sandbox is accepted', () => {
    const sandbox = event({ environment: 'SANDBOX' });

    expect(mapRevenueCatEvent(sandbox, OPTS)).toMatchObject({ status: 'ignored', reason: 'sandbox_not_accepted' });
    expect(mapRevenueCatEvent(sandbox, { ...OPTS, acceptSandbox: true }).status).toBe('effects');
  });

  it.each([null, 'x', 42, {}, { event: null }, { event: { type: 'RENEWAL' } }, event({ id: '' }), event({ event_timestamp_ms: 'soon' }), event({ type: 5 })])(
    'reports a malformed body as invalid: %j',
    (body) => {
      expect(mapRevenueCatEvent(body, OPTS).status).toBe('invalid');
    }
  );

  it('a transfer revokes the sources and asks to reconcile only the destinations', () => {
    const result = mapRevenueCatEvent(
      event({ type: 'TRANSFER', app_user_id: undefined, transferred_from: [USER_A, '$RCAnonymousID:zzz'], transferred_to: [USER_B] }),
      OPTS
    );

    expect(result).toMatchObject({ status: 'effects', effects: [{ userId: USER_A, effect: 'revoke' }], reconcile: [USER_B] });
  });
});

describe('isAuthorized', () => {
  it('accepts only the exact configured value', () => {
    expect(isAuthorized('Bearer s3cret', 'Bearer s3cret')).toBe(true);
    expect(isAuthorized('Bearer s3cret ', 'Bearer s3cret')).toBe(false);
    expect(isAuthorized('Bearer wrong!', 'Bearer s3cret')).toBe(false);
    expect(isAuthorized('', 'Bearer s3cret')).toBe(false);
    expect(isAuthorized(null, 'Bearer s3cret')).toBe(false);
  });

  it('fails closed when no secret is configured', () => {
    expect(isAuthorized('', '')).toBe(false);
    expect(isAuthorized('anything', undefined)).toBe(false);
  });
});

describe('handleRevenueCatWebhook', () => {
  const makeDeps = (over: Partial<WebhookDeps> = {}): WebhookDeps & { applied: unknown[] } => {
    const applied: unknown[] = [];
    return {
      secret: 'Bearer s3cret',
      options: OPTS,
      apply: async (call) => {
        applied.push(call);
        return 'applied';
      },
      reconcile: async () => null,
      applied,
      ...over,
    };
  };
  const request = (body: unknown, auth: string | null = 'Bearer s3cret', method = 'POST'): WebhookRequest => ({
    method,
    header: (name) => (name.toLowerCase() === 'authorization' ? auth : null),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });

  it('rejects a missing or wrong authorization header with 401 and applies nothing', async () => {
    const deps = makeDeps();

    expect((await handleRevenueCatWebhook(request(event(), null), deps)).status).toBe(401);
    expect((await handleRevenueCatWebhook(request(event(), 'Bearer nope'), deps)).status).toBe(401);
    expect(deps.applied).toEqual([]);
  });

  it('fails closed with 503 when no secret is configured', async () => {
    const deps = makeDeps({ secret: undefined });

    expect((await handleRevenueCatWebhook(request(event()), deps)).status).toBe(503);
    expect(deps.applied).toEqual([]);
  });

  it('rejects other methods and malformed bodies', async () => {
    const deps = makeDeps();

    expect((await handleRevenueCatWebhook(request(event(), 'Bearer s3cret', 'GET'), deps)).status).toBe(405);
    expect((await handleRevenueCatWebhook(request('{not json'), deps)).status).toBe(400);
    expect((await handleRevenueCatWebhook(request({ event: { id: 'x' } }), deps)).status).toBe(400);
    expect(deps.applied).toEqual([]);
  });

  it('applies a grant with the event identity and returns 200', async () => {
    const deps = makeDeps();

    const res = await handleRevenueCatWebhook(request(event()), deps);

    expect(res.status).toBe(200);
    expect(deps.applied).toEqual([{ eventId: 'evt-1', eventType: 'INITIAL_PURCHASE', eventMs: NOW - 1000, userId: USER_A, effect: 'grant', untilMs: NOW + 30 * DAY }]);
  });

  it('returns 200 without applying for events that never change access', async () => {
    const deps = makeDeps();

    expect((await handleRevenueCatWebhook(request(event({ type: 'BILLING_ISSUE' })), deps)).status).toBe(200);
    expect(deps.applied).toEqual([]);
  });

  it('returns 500 so RevenueCat retries when applying fails', async () => {
    const deps = makeDeps({
      apply: async () => {
        throw new Error('db down');
      },
    });

    expect((await handleRevenueCatWebhook(request(event()), deps)).status).toBe(500);
  });

  it('reconciles a transfer destination from RevenueCat and grants only what it confirms', async () => {
    const deps = makeDeps({ reconcile: async (userId) => (userId === USER_B ? { untilMs: NOW + 5 * DAY } : null) });

    const res = await handleRevenueCatWebhook(
      request(event({ type: 'TRANSFER', app_user_id: undefined, transferred_from: [USER_A], transferred_to: [USER_B] })),
      deps
    );

    expect(res.status).toBe(200);
    expect(deps.applied).toEqual([
      { eventId: 'evt-1', eventType: 'TRANSFER', eventMs: NOW - 1000, userId: USER_A, effect: 'revoke', untilMs: null },
      { eventId: 'evt-1', eventType: 'TRANSFER', eventMs: NOW - 1000, userId: USER_B, effect: 'grant', untilMs: NOW + 5 * DAY },
    ]);
  });

  it('does not grant a transfer destination when RevenueCat cannot confirm entitlement', async () => {
    const deps = makeDeps({ reconcile: async () => null });

    await handleRevenueCatWebhook(request(event({ type: 'TRANSFER', app_user_id: undefined, transferred_from: [], transferred_to: [USER_B] })), deps);

    expect(deps.applied).toEqual([]);
  });
});

describe('confirmEntitlement', () => {
  const reply = (status: number, body: unknown) => jest.fn(async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }));
  const subscriber = (entitlements: Record<string, unknown>) => ({ subscriber: { entitlements } });
  const iso = (ms: number) => new Date(ms).toISOString();

  it('returns the expiry of an active entitlement and calls RevenueCat with the key and user', async () => {
    const fetcher = reply(200, subscriber({ premium: { expires_date: iso(NOW + DAY) } }));

    const result = await confirmEntitlement(fetcher as never, 'sk_test', USER_B, 'premium', NOW);

    expect(result).toEqual({ untilMs: NOW + DAY });
    expect(fetcher).toHaveBeenCalledWith(`https://api.revenuecat.com/v1/subscribers/${USER_B}`, { headers: { Authorization: 'Bearer sk_test', Accept: 'application/json' } });
  });

  it('treats a null expiry as lifetime', async () => {
    const result = await confirmEntitlement(reply(200, subscriber({ premium: { expires_date: null } })) as never, 'k', USER_B, 'premium', NOW);

    expect(result).toEqual({ untilMs: null });
  });

  it('does not confirm an expired, missing or other entitlement', async () => {
    expect(await confirmEntitlement(reply(200, subscriber({ premium: { expires_date: iso(NOW - DAY) } })) as never, 'k', USER_B, 'premium', NOW)).toBeNull();
    expect(await confirmEntitlement(reply(200, subscriber({})) as never, 'k', USER_B, 'premium', NOW)).toBeNull();
    expect(await confirmEntitlement(reply(200, subscriber({ other: { expires_date: null } })) as never, 'k', USER_B, 'premium', NOW)).toBeNull();
    expect(await confirmEntitlement(reply(200, { nonsense: true }) as never, 'k', USER_B, 'premium', NOW)).toBeNull();
    expect(await confirmEntitlement(reply(200, subscriber({ premium: { expires_date: 'garbage' } })) as never, 'k', USER_B, 'premium', NOW)).toBeNull();
  });

  it('returns null for an unknown subscriber but throws on other failures so the webhook retries', async () => {
    expect(await confirmEntitlement(reply(404, {}) as never, 'k', USER_B, 'premium', NOW)).toBeNull();
    await expect(confirmEntitlement(reply(500, {}) as never, 'k', USER_B, 'premium', NOW)).rejects.toThrow();
  });
});
