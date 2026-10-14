import { createAdmin, createTestUser, TestUser, callFunction } from './helpers';

jest.setTimeout(120000);

const DAY = 86400000;
const now = () => Date.now();
const WEBHOOK_AUTH = process.env.REVENUECAT_WEBHOOK_AUTH ?? '';

describe('RevenueCat entitlement sync (live)', () => {
  const admin = createAdmin();
  let a: TestUser;
  let b: TestUser;
  let seq = 0;
  const id = (label: string) => `test-${Date.now()}-${++seq}-${label}`;

  const tierOf = async (userId: string) => {
    const { data } = await admin.from('entitlements').select('tier, source').eq('user_id', userId).single();
    return data as { tier: string; source: string | null };
  };
  const apply = async (userId: string, effect: 'grant' | 'revoke', over: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc('apply_billing_effect', {
      p_event_id: id(effect),
      p_event_type: effect === 'grant' ? 'INITIAL_PURCHASE' : 'EXPIRATION',
      p_event_ms: now(),
      p_user_id: userId,
      p_effect: effect,
      p_until_ms: effect === 'grant' ? now() + 30 * DAY : null,
      ...over,
    });
    expect(error).toBeNull();
    return data as string;
  };
  const reset = async (userId: string) => {
    await admin.from('billing_state').delete().eq('user_id', userId);
    await admin.from('revenuecat_events').delete().eq('user_id', userId);
    await admin.from('entitlements').update({ tier: 'free', source: null }).eq('user_id', userId);
  };

  beforeAll(async () => {
    a = await createTestUser(admin, 'rc-a');
    b = await createTestUser(admin, 'rc-b');
  });
  afterAll(async () => {
    for (const user of [a, b]) if (user) await admin.auth.admin.deleteUser(user.id);
  });
  beforeEach(async () => {
    await reset(a.id);
    await reset(b.id);
  });

  it('a purchase promotes the user and marks the source', async () => {
    expect(await apply(a.id, 'grant')).toBe('applied');

    expect(await tierOf(a.id)).toEqual({ tier: 'premium', source: 'revenuecat' });
  });

  it('a duplicate event id is recorded once and changes nothing', async () => {
    const eventId = id('dup');
    const first = await apply(a.id, 'grant', { p_event_id: eventId });
    await admin.from('entitlements').update({ tier: 'free' }).eq('user_id', a.id);

    const second = await apply(a.id, 'grant', { p_event_id: eventId });

    expect([first, second]).toEqual(['applied', 'duplicate']);
    expect((await tierOf(a.id)).tier).toBe('free');
    const { data } = await admin.from('revenuecat_events').select('event_id').eq('event_id', eventId);
    expect(data).toHaveLength(1);
  });

  it('a renewal extends the expiry', async () => {
    const t = now();
    await apply(a.id, 'grant', { p_event_ms: t, p_until_ms: t + DAY });
    await apply(a.id, 'grant', { p_event_type: 'RENEWAL', p_event_ms: t + 1000, p_until_ms: t + 31 * DAY });

    const { data } = await admin.from('billing_state').select('premium_until_ms').eq('user_id', a.id).single();
    expect(Number(data?.premium_until_ms)).toBe(t + 31 * DAY);
    expect((await tierOf(a.id)).tier).toBe('premium');
  });

  it('an expiration or refund removes access', async () => {
    const t = now();
    await apply(a.id, 'grant', { p_event_ms: t });
    expect(await apply(a.id, 'revoke', { p_event_ms: t + 1000 })).toBe('applied');
    expect((await tierOf(a.id)).tier).toBe('free');
  });

  it('a late old purchase after a revocation never restores access', async () => {
    const t = now();
    await apply(a.id, 'grant', { p_event_ms: t });
    await apply(a.id, 'revoke', { p_event_ms: t + 5000 });

    expect(await apply(a.id, 'grant', { p_event_ms: t + 1000, p_until_ms: t + 30 * DAY })).toBe('stale');
    expect(await apply(a.id, 'grant', { p_event_type: 'RENEWAL', p_event_ms: t + 4999 })).toBe('stale');
    expect((await tierOf(a.id)).tier).toBe('free');
  });

  it('a late old renewal cannot shorten newer access', async () => {
    const t = now();
    await apply(a.id, 'grant', { p_event_ms: t + 9000, p_until_ms: t + 60 * DAY });

    expect(await apply(a.id, 'grant', { p_event_ms: t, p_until_ms: t + DAY })).toBe('stale');
    const { data } = await admin.from('billing_state').select('premium_until_ms').eq('user_id', a.id).single();
    expect(Number(data?.premium_until_ms)).toBe(t + 60 * DAY);
  });

  it('a later purchase after a revocation restores access (resubscribe)', async () => {
    const t = now();
    await apply(a.id, 'grant', { p_event_ms: t });
    await apply(a.id, 'revoke', { p_event_ms: t + 1000 });

    expect(await apply(a.id, 'grant', { p_event_ms: t + 2000 })).toBe('applied');
    expect((await tierOf(a.id)).tier).toBe('premium');
  });

  it('a grant whose expiry is already past does not promote', async () => {
    await apply(a.id, 'grant', { p_until_ms: now() - DAY });

    expect((await tierOf(a.id)).tier).toBe('free');
  });

  it('lifetime access (no expiry) promotes', async () => {
    await apply(a.id, 'grant', { p_event_type: 'NON_RENEWING_PURCHASE', p_until_ms: null });

    expect((await tierOf(a.id)).tier).toBe('premium');
  });

  it('affects only the target user (cross-account isolation, transfer)', async () => {
    const t = now();
    await apply(a.id, 'grant', { p_event_ms: t });
    await apply(b.id, 'grant', { p_event_ms: t });

    // Transfer: A gives up access, B keeps its own and is untouched by A's revocation.
    await apply(a.id, 'revoke', { p_event_type: 'TRANSFER', p_event_ms: t + 1000 });

    expect((await tierOf(a.id)).tier).toBe('free');
    expect((await tierOf(b.id)).tier).toBe('premium');
  });

  it('reports an unknown user without recording or creating anything', async () => {
    const stranger = '99999999-9999-4999-8999-999999999999';

    expect(await apply(stranger, 'grant')).toBe('unknown_user');
  });

  it('keeps clients from editing entitlements, billing state, the ledger or the apply function', async () => {
    await apply(a.id, 'grant');
    const edit = await a.client.from('entitlements').update({ tier: 'premium' }).eq('user_id', a.id).select();
    expect(edit.data ?? []).toEqual([]);

    await admin.from('entitlements').update({ tier: 'free' }).eq('user_id', a.id);
    const forged = await a.client.from('entitlements').update({ tier: 'premium' }).eq('user_id', a.id).select();
    expect(forged.data ?? []).toEqual([]);
    expect((await tierOf(a.id)).tier).toBe('free');

    for (const table of ['billing_state', 'revenuecat_events']) {
      const read = await a.client.from(table).select('*');
      expect(read.error !== null || (read.data ?? []).length === 0).toBe(true);
      const write = await a.client.from(table).insert({ user_id: a.id });
      expect(write.error).not.toBeNull();
    }

    const rpc = await a.client.rpc('apply_billing_effect', {
      p_event_id: id('forge'),
      p_event_type: 'INITIAL_PURCHASE',
      p_event_ms: now(),
      p_user_id: a.id,
      p_effect: 'grant',
      p_until_ms: now() + DAY,
    });
    expect(rpc.error).not.toBeNull();
    expect((await tierOf(a.id)).tier).toBe('free');
  });

  describe('deployed revenuecat-webhook function', () => {
    const post = (body: object, auth?: string) =>
      callFunction('revenuecat-webhook', undefined, body, auth === undefined ? {} : { Authorization: auth });
    const body = (userId: string, over: Record<string, unknown> = {}) => ({
      api_version: '1.0',
      event: {
        id: id('http'),
        type: 'INITIAL_PURCHASE',
        app_user_id: userId,
        event_timestamp_ms: now(),
        expiration_at_ms: now() + 30 * DAY,
        entitlement_ids: ['premium'],
        environment: 'SANDBOX',
        ...over,
      },
    });

    it('rejects a missing or wrong authorization header with 401 and changes nothing', async () => {
      expect((await post(body(a.id))).status).toBe(401);
      expect((await post(body(a.id), 'Bearer wrong')).status).toBe(401);
      expect((await tierOf(a.id)).tier).toBe('free');
    });

    it('promotes on an authenticated purchase, is idempotent, then demotes on expiration', async () => {
      expect(WEBHOOK_AUTH).not.toBe('');
      const purchase = body(a.id);

      expect((await post(purchase, WEBHOOK_AUTH)).status).toBe(200);
      expect((await post(purchase, WEBHOOK_AUTH)).status).toBe(200);
      expect(await tierOf(a.id)).toEqual({ tier: 'premium', source: 'revenuecat' });
      const { data } = await admin.from('revenuecat_events').select('event_id').eq('event_id', purchase.event.id);
      expect(data).toHaveLength(1);

      const expire = body(a.id, { type: 'EXPIRATION', event_timestamp_ms: now() + 1000 });
      expect((await post(expire, WEBHOOK_AUTH)).status).toBe(200);
      expect((await tierOf(a.id)).tier).toBe('free');
    });

    it('does not let a late purchase restore access after an expiration', async () => {
      const t = now();
      await post(body(a.id, { event_timestamp_ms: t }), WEBHOOK_AUTH);
      await post(body(a.id, { type: 'EXPIRATION', event_timestamp_ms: t + 5000 }), WEBHOOK_AUTH);

      const late = await post(body(a.id, { event_timestamp_ms: t + 1000 }), WEBHOOK_AUTH);

      expect(late.status).toBe(200);
      expect((await tierOf(a.id)).tier).toBe('free');
    });

    it('changes only the user named in the event', async () => {
      await post(body(a.id), WEBHOOK_AUTH);

      expect((await tierOf(a.id)).tier).toBe('premium');
      expect((await tierOf(b.id)).tier).toBe('free');
    });

    it('keeps access after a normal cancellation and removes it on a refund', async () => {
      const t = now();
      await post(body(a.id, { event_timestamp_ms: t }), WEBHOOK_AUTH);

      await post(body(a.id, { type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', event_timestamp_ms: t + 1000 }), WEBHOOK_AUTH);
      expect((await tierOf(a.id)).tier).toBe('premium');

      await post(body(a.id, { type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', event_timestamp_ms: t + 2000 }), WEBHOOK_AUTH);
      expect((await tierOf(a.id)).tier).toBe('free');
    });

    it('never grants for malformed, anonymous or unknown-user events', async () => {
      expect((await post({ nope: true }, WEBHOOK_AUTH)).status).toBe(400);
      expect((await post(body('$RCAnonymousID:abc'), WEBHOOK_AUTH)).status).toBe(200);
      expect((await post(body('99999999-9999-4999-8999-999999999999'), WEBHOOK_AUTH)).status).toBe(200);
      expect((await tierOf(a.id)).tier).toBe('free');
    });
  });
});
