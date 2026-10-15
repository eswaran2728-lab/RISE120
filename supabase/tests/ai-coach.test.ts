import { createAdmin, createTestUser, callFunction, nodeFetch, supabaseUrl, publishableKey, TestUser } from './helpers';

jest.setTimeout(240000);

const uuid = () => crypto.randomUUID();
const nextMidnightUtc = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`).getTime() + 86400000;
const utcToday = () => new Date().toISOString().slice(0, 10);

// The deployed ai-coach function on the Rise120 DEVELOPMENT project. No model credentials are set there, so these
// tests never spend a model call: they cover authentication, the ledger, replay, isolation and quota. Provider
// behaviour (refusals, malformed output, unknown outcomes, safe proposals) is covered by ai-coach-handler.test.ts
// with a fake provider. If a Gemini key is ever set on this project, the "not configured" tests below fail loudly.
describe('ai-coach function (live, no provider configured)', () => {
  const admin = createAdmin();
  const pool: TestUser[] = [];
  let taken = 0;

  afterAll(async () => {
    for (const user of pool) await admin.auth.admin.deleteUser(user.id);
  });
  beforeEach(() => {
    taken = 0;
  });
  const freshUser = async () => {
    if (!pool[taken]) pool[taken] = await createTestUser(admin, 'aicoach');
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

  const ask = (user: TestUser, body: Record<string, unknown> = {}) => callFunction('ai-coach', user.jwt, { requestId: uuid(), message: 'How is my week going?', ...body });
  const allowance = async () => (await admin.from('app_config').select('value').eq('key', 'free_ai_messages_per_day').single()).data!.value as number;
  const rows = async (user: TestUser, table = 'coach_requests') => (await admin.from(table).select('*').eq('user_id', user.id)).data ?? [];
  const aiUsed = async (user: TestUser) => (await admin.from('usage_daily').select('ai_messages').eq('user_id', user.id).eq('usage_date', utcToday()).maybeSingle()).data?.ai_messages ?? 0;
  // A request completed through the same ledger operations the function uses.
  const complete = async (user: TestUser, requestId = uuid(), proposal: unknown = null, reply = 'A stored coach reply.') => {
    const reserved = await admin.rpc('coach_reserve_request', { p_user_id: user.id, p_request_id: requestId });
    expect(reserved.error).toBeNull();
    const done = await admin.rpc('coach_finish_request', {
      p_user_id: user.id, p_request_id: requestId, p_message: 'A question', p_reply: reply, p_language: 'en', p_proposal: proposal,
    });
    expect(done.error).toBeNull();
    return { requestId, messageId: (done.data as { message_id: string }).message_id };
  };

  describe('authentication and input', () => {
    it('answers 401 without a JWT and with a bad JWT, and touches nothing', async () => {
      const user = await freshUser();

      expect((await callFunction('ai-coach', undefined, { requestId: uuid(), message: 'hi' })).status).toBe(401);
      expect((await callFunction('ai-coach', 'not-a-real-token', { requestId: uuid(), message: 'hi' })).status).toBe(401);
      expect(await rows(user)).toEqual([]);
    });

    it('answers 405 to a GET', async () => {
      const res = await nodeFetch(`${supabaseUrl}/functions/v1/ai-coach`, { method: 'GET', headers: { apikey: publishableKey } });

      expect(res.status).toBe(405);
    });

    it.each([
      ['no request id', { requestId: undefined }],
      ['a request id that is not a UUID', { requestId: 'nope' }],
      ['an empty message', { message: '  ' }],
      ['a message that is too long', { message: 'x'.repeat(5000) }],
    ])('answers 400 INVALID_REQUEST for %s, using no allowance', async (_name, override) => {
      const user = await freshUser();

      const res = await ask(user, override);

      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: 'INVALID_REQUEST' });
      expect(await rows(user)).toEqual([]);
    });
  });

  describe('when the provider is not configured', () => {
    it('answers COACH_UNAVAILABLE, releases the slot, and charges nothing', async () => {
      const user = await freshUser();

      const first = await ask(user);
      const second = await ask(user); // a charged first attempt would make this AI_LIMIT_REACHED

      expect(first.status).not.toBe(200); // fails loudly if a model key was ever set on this project
      expect(first).toMatchObject({ status: 503, json: { error: 'COACH_UNAVAILABLE' } });
      expect(second.status).toBe(503);
      expect(await aiUsed(user)).toBe(0);
      expect((await rows(user)).every((r) => r.status === 'failed')).toBe(true);
      expect(await rows(user, 'coach_messages')).toEqual([]);
    });

    it('gives no internal detail in the error body', async () => {
      const user = await freshUser();

      const res = await ask(user);

      expect(Object.keys(res.json)).toEqual(['error']);
    });

    it('ignores a user id in the body: only the signed-in account gets a ledger row', async () => {
      const [a, b] = [await freshUser(), await freshUser()];

      await ask(a, { userId: b.id, user_id: b.id });

      expect((await rows(a)).length).toBe(1);
      expect(await rows(b)).toEqual([]);
    });
  });

  describe('quota', () => {
    it('answers AI_LIMIT_REACHED with the UTC reset time when the allowance is used up, creating no request', async () => {
      const user = await freshUser();
      const n = await allowance();
      for (let i = 0; i < n; i++) await complete(user);

      const res = await ask(user);

      expect(res.status).toBe(429);
      expect(res.json.error).toBe('AI_LIMIT_REACHED');
      expect(Date.parse(res.json.resetsAt)).toBe(nextMidnightUtc());
      expect((await rows(user)).length).toBe(n);
      expect(await aiUsed(user)).toBe(n);
    });

    it('lets a verified AI ad credit make room again', async () => {
      const user = await freshUser();
      const n = await allowance();
      for (let i = 0; i < n; i++) await complete(user);
      await admin.from('ad_credits').insert({ user_id: user.id, reward_type: 'ai', credits: 1, quota_day: utcToday(), transaction_id: `aicoach-${uuid()}` });

      const res = await ask(user);

      expect(res.status).toBe(503); // admitted, then the unconfigured provider fails
      expect(res.json.error).toBe('COACH_UNAVAILABLE');
    });

    it('does not limit a premium member', async () => {
      const user = await freshUser();
      await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id);
      const n = await allowance();
      for (let i = 0; i < n + 1; i++) await complete(user);

      expect((await ask(user)).json.error).toBe('COACH_UNAVAILABLE');
    });
  });

  describe('retries and isolation', () => {
    it('returns the stored reply and proposal for a completed request id, charging nothing more', async () => {
      const user = await freshUser();
      const proposal = { patches: [{ dayNumber: 5, next: { calorieTarget: 2700 }, expected: { workout: { kind: 'rest' }, calorieTarget: 2650, proteinTargetG: 125 } }] };
      const done = await complete(user, uuid(), proposal, 'Eat a little more on day 5.');

      const res = await ask(user, { requestId: done.requestId });

      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({
        requestId: done.requestId,
        messageId: done.messageId,
        reply: 'Eat a little more on day 5.',
        language: 'en',
        proposal: { status: 'pending', patches: proposal.patches },
      });
      expect(typeof res.json.proposal.id).toBe('string');
      expect(await aiUsed(user)).toBe(1);
      expect((await rows(user)).length).toBe(1);
    });

    it('answers concurrent replays of one completed request identically', async () => {
      const user = await freshUser();
      const done = await complete(user);

      const results = await Promise.all([1, 2, 3, 4].map(() => ask(user, { requestId: done.requestId })));

      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(new Set(results.map((r) => r.json.messageId))).toEqual(new Set([done.messageId]));
      expect(await aiUsed(user)).toBe(1);
    });

    it('answers COACH_IN_PROGRESS to a retry of an unfinished request, never starting it again', async () => {
      const user = await freshUser();
      const requestId = uuid();
      expect((await admin.rpc('coach_reserve_request', { p_user_id: user.id, p_request_id: requestId })).error).toBeNull();

      const res = await ask(user, { requestId });

      expect(res).toMatchObject({ status: 409, json: { error: 'COACH_IN_PROGRESS' } });
      expect((await rows(user))[0].status).toBe('reserved');
      expect(await aiUsed(user)).toBe(0);
    });

    it("never shows account A's stored reply to account B who sends the same request id", async () => {
      const [a, b] = [await freshUser(), await freshUser()];
      const done = await complete(a, uuid(), null, 'A private reply for account A only.');

      const res = await ask(b, { requestId: done.requestId });

      expect(res.status).toBe(503); // B's own new request, with no provider configured
      expect(JSON.stringify(res.json)).not.toContain('private reply');
      expect(await aiUsed(a)).toBe(1);
      expect(await aiUsed(b)).toBe(0);
    });
  });
});
