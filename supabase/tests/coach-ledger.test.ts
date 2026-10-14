import { createAdmin, createTestClient, createTestUser, callFunction, publishableKey, TestUser } from './helpers';

jest.setTimeout(240000);

const utcToday = () => new Date().toISOString().slice(0, 10);
const nextMidnightUtc = () => new Date(`${utcToday()}T00:00:00.000Z`).getTime() + 86400000;
const uuid = () => crypto.randomUUID();

type Reservation = { status: 'reserved' | 'completed' | 'in_progress' | 'limited'; resets_at: string; message_id?: string };

// The coach ledger: one row per request, one stored reply per completed request, and the AI allowance enforced
// atomically in the database. The provider is never called here; these tests drive the same operations the
// ai-coach function will use.
describe('coach ledger and atomic AI allowance (live)', () => {
  const admin = createAdmin();
  const pool: TestUser[] = [];
  let taken = 0;

  afterAll(async () => {
    for (const user of pool) await admin.auth.admin.deleteUser(user.id);
  });

  // The auth API is rate limited, so a few users are reused and reset instead of one per test.
  beforeEach(() => {
    taken = 0;
  });
  const freshUser = async () => {
    if (!pool[taken]) pool[taken] = await createTestUser(admin, 'coach');
    const user = pool[taken++];
    await admin.from('coach_proposals').delete().eq('user_id', user.id);
    await admin.from('coach_messages').delete().eq('user_id', user.id);
    await admin.from('coach_requests').delete().eq('user_id', user.id);
    await admin.from('usage_daily').delete().eq('user_id', user.id);
    await admin.from('ad_credits').delete().eq('user_id', user.id);
    await admin.from('billing_state').delete().eq('user_id', user.id);
    await admin.from('entitlements').update({ tier: 'free', source: null }).eq('user_id', user.id);
    return user;
  };

  const reserve = async (user: TestUser, requestId = uuid(), extra: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc('coach_reserve_request', { p_user_id: user.id, p_request_id: requestId, ...extra });
    expect(error).toBeNull();
    return { requestId, ...(data as Reservation) };
  };
  const finish = async (user: TestUser, requestId: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc('coach_finish_request', {
      p_user_id: user.id,
      p_request_id: requestId,
      p_message: 'How should I train this week?',
      p_reply: 'Keep going, and rest well.',
      p_language: 'en',
      p_proposal: null,
      ...extra,
    });
    expect(error).toBeNull();
    return data as { status: string; message_id?: string };
  };
  const fail = async (user: TestUser, requestId: string) => {
    const { data, error } = await admin.rpc('coach_fail_request', { p_user_id: user.id, p_request_id: requestId });
    expect(error).toBeNull();
    return data as { status: string };
  };
  const aiUsed = async (user: TestUser) =>
    (await admin.from('usage_daily').select('ai_messages').eq('user_id', user.id).eq('usage_date', utcToday()).maybeSingle()).data?.ai_messages ?? 0;
  const count = async (table: string, user: TestUser) => (await admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', user.id)).count ?? 0;
  const addAiCredit = (user: TestUser, credits = 1) =>
    admin.from('ad_credits').insert({ user_id: user.id, reward_type: 'ai', credits, quota_day: utcToday(), transaction_id: `coach-${uuid()}` });

  describe('admission', () => {
    it('reserves the first free request and limits the second when the allowance is 1, with the UTC reset time', async () => {
      const user = await freshUser();

      const first = await reserve(user);
      const second = await reserve(user);

      expect(first.status).toBe('reserved');
      expect(second.status).toBe('limited');
      expect(Date.parse(second.resets_at)).toBe(nextMidnightUtc());
    });

    it('admits exactly the number of requests the server configures', async () => {
      // Other suites read the shared AI config, so it is read here, never rewritten.
      const configured = (await admin.from('app_config').select('value').eq('key', 'free_ai_messages_per_day').single()).data!.value as number;
      const user = await freshUser();

      const statuses: string[] = [];
      for (let i = 0; i < configured + 1; i++) statuses.push((await reserve(user)).status);

      expect(statuses.filter((s) => s === 'reserved')).toHaveLength(configured);
      expect(statuses[configured]).toBe('limited');
    });

    it('adds verified AI ad credits to the allowance, but not food credits or another day', async () => {
      const user = await freshUser();
      await admin.from('ad_credits').insert({ user_id: user.id, reward_type: 'food', credits: 2, quota_day: utcToday(), transaction_id: `coach-${uuid()}` });
      await admin.from('ad_credits').insert({ user_id: user.id, reward_type: 'ai', credits: 1, quota_day: '2020-01-01', transaction_id: `coach-${uuid()}` });
      await reserve(user);
      expect((await reserve(user)).status).toBe('limited');

      await addAiCredit(user, 1);

      expect((await reserve(user)).status).toBe('reserved');
      expect((await reserve(user)).status).toBe('limited');
    });

    it('lets a premium user past the cap, including lifetime and unexpired subscriptions', async () => {
      const user = await freshUser();
      await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id);

      const statuses = [(await reserve(user)).status, (await reserve(user)).status, (await reserve(user)).status];
      expect(statuses).toEqual(['reserved', 'reserved', 'reserved']);

      await admin.from('coach_requests').delete().eq('user_id', user.id);
      await admin.from('billing_state').upsert({ user_id: user.id, last_event_ms: 1, premium_active: true, premium_until_ms: Date.now() + 86400000 });
      expect((await reserve(user)).status).toBe('reserved');
      expect((await reserve(user)).status).toBe('reserved');
    });

    it('limits an account whose premium expired even if the tier column still says premium', async () => {
      const user = await freshUser();
      await admin.from('entitlements').update({ tier: 'premium', source: 'revenuecat' }).eq('user_id', user.id);
      await admin.from('billing_state').upsert({ user_id: user.id, last_event_ms: 1, premium_active: true, premium_until_ms: Date.now() - 60000 });

      expect((await reserve(user)).status).toBe('reserved');
      expect((await reserve(user)).status).toBe('limited');
    });

    it('admits exactly one of several concurrent requests for the last free slot', async () => {
      const user = await freshUser();

      const results = await Promise.all([1, 2, 3, 4].map(() => reserve(user)));

      expect(results.filter((r) => r.status === 'reserved')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'limited')).toHaveLength(3);
      expect(await count('coach_requests', user)).toBe(1);
    });

    it('rejects an invalid lease', async () => {
      const user = await freshUser();

      const { error } = await admin.rpc('coach_reserve_request', { p_user_id: user.id, p_request_id: uuid(), p_lease_seconds: 0 });

      expect(error).not.toBeNull();
    });
  });

  describe('settlement', () => {
    it('charges once when a reserved request completes, and stores one reply', async () => {
      const user = await freshUser();
      const { requestId } = await reserve(user);
      expect(await aiUsed(user)).toBe(0); // a reservation alone does not charge

      const done = await finish(user, requestId);

      expect(done.status).toBe('completed');
      expect(await aiUsed(user)).toBe(1);
      const { data } = await admin.from('coach_messages').select('request_id, message, reply, language').eq('user_id', user.id);
      expect(data).toEqual([{ request_id: requestId, message: 'How should I train this week?', reply: 'Keep going, and rest well.', language: 'en' }]);
    });

    it('does not charge or store a second reply when the same request completes twice', async () => {
      const user = await freshUser();
      const { requestId } = await reserve(user);
      const first = await finish(user, requestId);

      const again = await finish(user, requestId, { p_reply: 'A different reply' });

      expect(again).toMatchObject({ status: 'completed', message_id: first.message_id });
      expect(await aiUsed(user)).toBe(1);
      expect(await count('coach_messages', user)).toBe(1);
      expect((await admin.from('coach_messages').select('reply').eq('user_id', user.id).single()).data?.reply).toBe('Keep going, and rest well.');
    });

    it('returns the stored result for the same request id, even when the allowance is used up', async () => {
      const user = await freshUser();
      const { requestId } = await reserve(user);
      const done = await finish(user, requestId);

      const replay = await reserve(user, requestId);

      expect(replay).toMatchObject({ status: 'completed', message_id: done.message_id });
      expect(await aiUsed(user)).toBe(1);
    });

    it('stores an optional proposal with the reply, as pending', async () => {
      const user = await freshUser();
      const { requestId } = await reserve(user);

      await finish(user, requestId, { p_proposal: { day: 20, note: 'lighter day' } });

      const { data } = await admin.from('coach_proposals').select('request_id, patch, status').eq('user_id', user.id);
      expect(data).toEqual([{ request_id: requestId, patch: { day: 20, note: 'lighter day' }, status: 'pending' }]);
    });

    it('counts premium usage too, and shows it in check-limit', async () => {
      const user = await freshUser();
      await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id);
      for (let i = 0; i < 2; i++) await finish(user, (await reserve(user)).requestId);

      expect(await aiUsed(user)).toBe(2);
      const { json } = await callFunction('check-limit', user.jwt, {});
      expect(json.ai.used).toBe(2);
    });

    it('shows the charge in check-limit and leaves the free user with nothing remaining', async () => {
      const user = await freshUser();
      await finish(user, (await reserve(user)).requestId);

      const { json } = await callFunction('check-limit', user.jwt, {});

      expect(json.ai.used).toBe(1);
      expect(json.ai.remaining).toBe(Math.max(0, json.ai.base + json.ai.bonus - 1));
    });

    it('refuses to complete a request that was never reserved', async () => {
      const user = await freshUser();

      const done = await finish(user, uuid());

      expect(done.status).toBe('not_found');
      expect(await aiUsed(user)).toBe(0);
      expect(await count('coach_messages', user)).toBe(0);
    });

    it('rejects an oversized or empty message and reply, and charges nothing', async () => {
      const user = await freshUser();
      const { requestId } = await reserve(user);

      for (const bad of [{ p_message: '' }, { p_reply: '' }, { p_message: 'x'.repeat(100000) }, { p_reply: 'y'.repeat(100000) }]) {
        const { error } = await admin.rpc('coach_finish_request', {
          p_user_id: user.id,
          p_request_id: requestId,
          p_message: 'ok',
          p_reply: 'ok',
          p_language: 'en',
          p_proposal: null,
          ...bad,
        });
        expect(error).not.toBeNull();
      }

      expect(await aiUsed(user)).toBe(0);
      expect(await count('coach_messages', user)).toBe(0);
    });
  });

  describe('failures and retries', () => {
    it('releases the slot when a request fails, and charges nothing', async () => {
      const user = await freshUser();
      const first = await reserve(user);
      expect((await reserve(user)).status).toBe('limited'); // the slot is held

      expect((await fail(user, first.requestId)).status).toBe('failed');

      expect(await aiUsed(user)).toBe(0);
      expect((await reserve(user)).status).toBe('reserved');
    });

    it('lets a failed request id be tried again, and charges once in total', async () => {
      const user = await freshUser();
      const { requestId } = await reserve(user);
      await fail(user, requestId);

      expect((await reserve(user, requestId)).status).toBe('reserved');
      await finish(user, requestId);

      expect(await aiUsed(user)).toBe(1);
      expect(await count('coach_requests', user)).toBe(1);
    });

    it('does not fail a request that already completed', async () => {
      const user = await freshUser();
      const { requestId } = await reserve(user);
      await finish(user, requestId);

      expect((await fail(user, requestId)).status).toBe('completed');
      expect(await aiUsed(user)).toBe(1);
    });

    it('answers "in progress" to a retry of an unfinished request, never "reserved" again', async () => {
      const user = await freshUser();
      const { requestId } = await reserve(user);

      const retry = await reserve(user, requestId);
      const another = await reserve(user, requestId);

      expect(retry.status).toBe('in_progress');
      expect(another.status).toBe('in_progress');
      expect(await count('coach_requests', user)).toBe(1);
    });

    it('stops an abandoned reservation holding the slot forever, without allowing the same id to run again', async () => {
      const user = await freshUser();
      const { requestId } = await reserve(user, uuid(), { p_lease_seconds: 60 });
      expect((await reserve(user)).status).toBe('limited');

      // The lease runs out (the provider outcome is unknown): the slot frees up, but this id stays unresolved.
      await admin.from('coach_requests').update({ lease_until: new Date(Date.now() - 1000).toISOString() }).eq('user_id', user.id).eq('request_id', requestId);

      expect((await reserve(user, requestId)).status).toBe('in_progress');
      expect((await reserve(user)).status).toBe('reserved');
    });

    it('still lets an unfinished request complete exactly once after its lease ran out', async () => {
      const user = await freshUser();
      const { requestId } = await reserve(user);
      await admin.from('coach_requests').update({ lease_until: new Date(Date.now() - 1000).toISOString() }).eq('user_id', user.id).eq('request_id', requestId);

      expect((await finish(user, requestId)).status).toBe('completed');
      expect((await finish(user, requestId)).status).toBe('completed');

      expect(await aiUsed(user)).toBe(1);
    });

    it('records the UTC quota day with the request', async () => {
      const user = await freshUser();
      const { requestId } = await reserve(user);

      const { data } = await admin.from('coach_requests').select('quota_day, status').eq('user_id', user.id).eq('request_id', requestId).single();

      expect(data).toEqual({ quota_day: utcToday(), status: 'reserved' });
    });
  });

  // A reservation holds its slot only for a lease. If the lease runs out and the slot is taken by another
  // request, a late finish must not be charged on top of the allowance.
  describe('finishing after the lease ran out', () => {
    const expire = (user: TestUser, requestId: string) =>
      admin.from('coach_requests').update({ lease_until: new Date(Date.now() - 1000).toISOString() }).eq('user_id', user.id).eq('request_id', requestId);
    // The server-configured number of free messages (read, never rewritten: other suites depend on it).
    const configuredAllowance = async () =>
      (await admin.from('app_config').select('value').eq('key', 'free_ai_messages_per_day').single()).data!.value as number;
    // Fills every free slot with completed replies, as other requests that took the freed slots.
    const fillSlots = async (user: TestUser, n: number) => {
      for (let i = 0; i < n; i++) expect((await finish(user, (await reserve(user)).requestId)).status).toBe('completed');
    };

    it('keeps only one reply and one charge when the slot was taken before the late finish', async () => {
      const user = await freshUser();
      const allowance = await configuredAllowance();
      const a = await reserve(user);
      expect(a.status).toBe('reserved');
      await expire(user, a.requestId);
      await fillSlots(user, allowance); // other requests take the freed slots

      const late = await finish(user, a.requestId, { p_reply: 'A late reply', p_proposal: { day: 20 } });

      expect(late.status).toBe('slot_taken');
      expect(late.message_id).toBeUndefined();
      expect(await aiUsed(user)).toBe(allowance);
      expect(await count('coach_messages', user)).toBe(allowance);
      expect(await count('coach_proposals', user)).toBe(0);
      expect((await admin.from('coach_messages').select('reply').eq('user_id', user.id).eq('request_id', a.requestId)).data).toEqual([]);
    });

    it('succeeds when the late finish still has a free slot', async () => {
      const user = await freshUser();
      const a = await reserve(user);
      await expire(user, a.requestId);

      const late = await finish(user, a.requestId, { p_proposal: { day: 20 } });

      expect(late.status).toBe('completed');
      expect(late.message_id).toBeDefined();
      expect(await aiUsed(user)).toBe(1);
      expect(await count('coach_messages', user)).toBe(1);
      expect(await count('coach_proposals', user)).toBe(1);
    });

    it('counts another live reservation as holding the slot', async () => {
      const user = await freshUser();
      const allowance = await configuredAllowance();
      const a = await reserve(user);
      await expire(user, a.requestId);
      for (let i = 0; i < allowance; i++) expect((await reserve(user)).status).toBe('reserved'); // live, not finished

      expect((await finish(user, a.requestId)).status).toBe('slot_taken');
      expect(await aiUsed(user)).toBe(0);
      expect(await count('coach_messages', user)).toBe(0);
    });

    it('succeeds when a verified AI credit made room for the late finish', async () => {
      const user = await freshUser();
      const allowance = await configuredAllowance();
      const a = await reserve(user);
      await expire(user, a.requestId);
      await fillSlots(user, allowance);
      await addAiCredit(user, 1);

      expect((await finish(user, a.requestId)).status).toBe('completed');
      expect(await aiUsed(user)).toBe(allowance + 1);
    });

    it('never blocks a premium user, and rechecks with the effective-premium rule', async () => {
      const user = await freshUser();
      const allowance = await configuredAllowance();
      await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id);
      const a = await reserve(user);
      await expire(user, a.requestId);
      await fillSlots(user, allowance + 1);
      expect((await finish(user, a.requestId)).status).toBe('completed');

      // A lapsed subscription is not premium, even though the tier column still says so.
      const lapsed = await freshUser();
      await admin.from('entitlements').update({ tier: 'premium', source: 'revenuecat' }).eq('user_id', lapsed.id);
      await admin.from('billing_state').upsert({ user_id: lapsed.id, last_event_ms: 1, premium_active: true, premium_until_ms: Date.now() + 86400000 });
      const b = await reserve(lapsed);
      await expire(lapsed, b.requestId);
      await fillSlots(lapsed, allowance + 1); // still premium: all admitted
      await admin.from('billing_state').update({ premium_until_ms: Date.now() - 60000 }).eq('user_id', lapsed.id);
      expect((await finish(lapsed, b.requestId)).status).toBe('slot_taken');
    });

    it('does not recheck a reservation that is still live', async () => {
      const user = await freshUser();
      const a = await reserve(user);

      expect((await finish(user, a.requestId)).status).toBe('completed');
      expect(await aiUsed(user)).toBe(1);
    });

    it("uses the request's own quota day, not today", async () => {
      const user = await freshUser();
      const allowance = await configuredAllowance();
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const a = await reserve(user);
      await admin.from('coach_requests').update({ quota_day: yesterday, lease_until: new Date(Date.now() - 1000).toISOString() }).eq('user_id', user.id).eq('request_id', a.requestId);
      await fillSlots(user, allowance); // today is full; yesterday is empty

      expect((await finish(user, a.requestId)).status).toBe('completed');

      const usage = (await admin.from('usage_daily').select('usage_date, ai_messages').eq('user_id', user.id)).data ?? [];
      expect(usage.find((u) => u.usage_date === yesterday)?.ai_messages).toBe(1);
      expect(usage.find((u) => u.usage_date === utcToday())?.ai_messages).toBe(allowance);
    });

    it('releases the lost request so it is not stuck, and a retry follows the normal rules', async () => {
      const user = await freshUser();
      const allowance = await configuredAllowance();
      const a = await reserve(user);
      await expire(user, a.requestId);
      await fillSlots(user, allowance);
      expect((await finish(user, a.requestId)).status).toBe('slot_taken');

      expect((await finish(user, a.requestId)).status).toBe('not_reserved'); // no reply can be stored for it now
      expect((await reserve(user, a.requestId)).status).toBe('limited'); // retrying is held to the allowance
      expect(await aiUsed(user)).toBe(allowance);
    });

    it('lets the lost request be tried again once there is room, charging once', async () => {
      const user = await freshUser();
      const allowance = await configuredAllowance();
      const a = await reserve(user);
      await expire(user, a.requestId);
      await fillSlots(user, allowance);
      await finish(user, a.requestId); // slot_taken
      await addAiCredit(user, 1);

      expect((await reserve(user, a.requestId)).status).toBe('reserved');
      expect((await finish(user, a.requestId)).status).toBe('completed');
      expect(await aiUsed(user)).toBe(allowance + 1);
    });

    it('is not affected by another account taking its own slots', async () => {
      const [a, b] = [await freshUser(), await freshUser()];
      const allowance = await configuredAllowance();
      const request = await reserve(a);
      await expire(a, request.requestId);
      await fillSlots(b, allowance);

      expect((await finish(a, request.requestId)).status).toBe('completed');
      expect(await aiUsed(a)).toBe(1);
      expect(await aiUsed(b)).toBe(allowance);
    });

    it('lets exactly one of a lost slot and a racing new request win', async () => {
      const user = await freshUser();
      const allowance = await configuredAllowance();
      const a = await reserve(user);
      await expire(user, a.requestId);
      await fillSlots(user, allowance - 1);

      const [late, fresh] = await Promise.all([finish(user, a.requestId), reserve(user, uuid())]);

      // Whichever runs first takes the last slot; the other is refused. Never both.
      const lateWon = late.status === 'completed';
      const freshWon = fresh.status === 'reserved';
      expect(lateWon !== freshWon).toBe(true);
      if (freshWon) expect(late.status).toBe('slot_taken');
      else expect(fresh.status).toBe('limited');
    });
  });

  describe('isolation and server-only writes', () => {
    it('keeps requests, replies and proposals private to their account', async () => {
      const [a, b] = [await freshUser(), await freshUser()];
      const { requestId } = await reserve(a);
      await finish(a, requestId, { p_proposal: { day: 20 } });

      for (const table of ['coach_requests', 'coach_messages', 'coach_proposals']) {
        expect((await a.client.from(table).select('*')).data).toHaveLength(1);
        expect((await b.client.from(table).select('*')).data).toEqual([]);
        expect((await b.client.from(table).select('*').eq('user_id', a.id)).data).toEqual([]);
      }
    });

    it('treats the same request id from two accounts as two independent requests', async () => {
      const [a, b] = [await freshUser(), await freshUser()];
      const shared = uuid();

      expect((await reserve(a, shared)).status).toBe('reserved');
      expect((await reserve(b, shared)).status).toBe('reserved');
      await finish(a, shared);

      expect(await aiUsed(a)).toBe(1);
      expect(await aiUsed(b)).toBe(0);
      expect((await reserve(b, shared)).status).toBe('in_progress');
    });

    it("charges only the account that owns the request when another account's id is used", async () => {
      const [a, b] = [await freshUser(), await freshUser()];
      const { requestId } = await reserve(a);

      expect((await finish(b, requestId)).status).toBe('not_found');

      expect(await aiUsed(a)).toBe(0);
      expect(await aiUsed(b)).toBe(0);
    });

    it('blocks every client write to the ledger and to usage', async () => {
      const [a, b] = [await freshUser(), await freshUser()];
      const { requestId } = await reserve(a);
      await finish(a, requestId, { p_proposal: { day: 20 } });

      for (const table of ['coach_requests', 'coach_messages', 'coach_proposals']) {
        const insert = await a.client.from(table).insert({ user_id: a.id, request_id: uuid() });
        const update = await a.client.from(table).update({ status: 'completed' }).eq('user_id', a.id).select();
        const del = await a.client.from(table).delete().eq('user_id', a.id).select();
        const foreignUpdate = await b.client.from(table).update({ user_id: b.id }).eq('user_id', a.id).select();
        expect(insert.error).not.toBeNull();
        expect(update.error).not.toBeNull();
        expect(del.error).not.toBeNull();
        expect(foreignUpdate.error).not.toBeNull();
      }
      expect((await a.client.from('usage_daily').update({ ai_messages: 0 }).eq('user_id', a.id).select()).error).not.toBeNull();
      expect((await a.client.from('usage_daily').insert({ user_id: a.id, usage_date: '2020-01-01', ai_messages: 0 })).error).not.toBeNull();
      expect(await aiUsed(a)).toBe(1);
      expect(await count('coach_messages', a)).toBe(1);
    });

    it('keeps the ledger functions away from clients and anonymous callers', async () => {
      const user = await freshUser();
      const anon = createTestClient(publishableKey);
      const calls: [string, Record<string, unknown>][] = [
        ['coach_reserve_request', { p_user_id: user.id, p_request_id: uuid() }],
        ['coach_finish_request', { p_user_id: user.id, p_request_id: uuid(), p_message: 'a', p_reply: 'b', p_language: 'en', p_proposal: null }],
        ['coach_fail_request', { p_user_id: user.id, p_request_id: uuid() }],
      ];

      for (const [name, args] of calls) {
        expect((await user.client.rpc(name, args)).error).not.toBeNull();
        expect((await anon.rpc(name, args)).error).not.toBeNull();
      }
      expect(await count('coach_requests', user)).toBe(0);
    });
  });

  describe('account deletion', () => {
    it('removes the ledger, replies and proposals with the account, and leaves other accounts alone', async () => {
      const doomed = await createTestUser(admin, 'coach-del');
      const other = await freshUser();
      for (const user of [doomed, other]) {
        const { requestId } = await reserve(user);
        await finish(user, requestId, { p_proposal: { day: 20 } });
      }

      const { error } = await admin.auth.admin.deleteUser(doomed.id);

      expect(error).toBeNull();
      for (const table of ['coach_requests', 'coach_messages', 'coach_proposals']) {
        expect((await admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', doomed.id)).count).toBe(0);
        expect(await count(table, other)).toBe(1);
      }
    });

    it('removes them through the delete-account function too', async () => {
      const doomed = await createTestUser(admin, 'coach-del2');
      const { requestId } = await reserve(doomed);
      await finish(doomed, requestId, { p_proposal: { day: 20 } });

      const { status } = await callFunction('delete-account', doomed.jwt, {});

      expect(status).toBe(200);
      for (const table of ['coach_requests', 'coach_messages', 'coach_proposals']) {
        expect((await admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', doomed.id)).count).toBe(0);
      }
    });
  });
});
