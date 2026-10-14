import { createHash, randomBytes } from 'crypto';
import { createAdmin, createTestUser, callFunction, nodeFetch, supabaseUrl, TestUser } from './helpers';

jest.setTimeout(240000);

const utcToday = () => new Date().toISOString().slice(0, 10);
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

// The signature check is covered by admob-ssv.test.ts with signed fixtures. These tests cover what happens
// once a callback is verified: the one-use token, the transaction ledger, the daily cap and the credits.
describe('verified ad reward ledger (live)', () => {
  const admin = createAdmin();
  const suffix = `${Date.now()}`;
  const pool: TestUser[] = [];
  let taken = 0;
  let sharedFoodId: string;
  const original: Record<string, unknown> = {};

  beforeAll(async () => {
    const { data } = await admin.from('app_config').select('key, value').in('key', ['ad_rewards_max_per_day', 'ad_reward_food_logs', 'ad_reward_ai_messages']);
    for (const row of data ?? []) original[row.key] = row.value;
    sharedFoodId = (
      await admin
        .from('foods')
        .insert({ name: `Ad shared ${suffix}`, serving_desc: '1', calories: 100, protein_g: 5, carbs_g: 15, fat_g: 2, user_id: null, source: 'usda', verified: false, source_id: `ad-${suffix}` })
        .select('id')
        .single()
    ).data!.id;
  });
  afterAll(async () => {
    for (const [key, value] of Object.entries(original)) await admin.from('app_config').update({ value }).eq('key', key);
    for (const user of pool) await admin.auth.admin.deleteUser(user.id);
    if (sharedFoodId) await admin.from('foods').delete().eq('id', sharedFoodId);
  });

  // The auth API is rate limited, so a few users are reused and reset instead of creating one per test.
  beforeEach(() => {
    taken = 0;
  });
  const freshUser = async () => {
    if (!pool[taken]) pool[taken] = await createTestUser(admin, 'ad');
    const user = pool[taken++];
    await admin.from('ad_reward_requests').delete().eq('user_id', user.id);
    await admin.from('ad_credits').delete().eq('user_id', user.id);
    await admin.from('food_logs').delete().eq('user_id', user.id);
    await admin.from('entitlements').update({ tier: 'free' }).eq('user_id', user.id);
    return user;
  };
  const setConfig = (key: string, value: unknown) => admin.from('app_config').update({ value }).eq('key', key);
  const newToken = () => randomBytes(24).toString('base64url');
  const issue = async (user: TestUser, type: 'food' | 'ai' = 'food', token = newToken(), ttl = 900) => {
    const { data, error } = await admin.rpc('request_ad_reward', { p_user_id: user.id, p_reward_type: type, p_token_hash: hashOf(token), p_ttl_seconds: ttl });
    expect(error).toBeNull();
    return { token, outcome: data as string };
  };
  const txId = () => randomBytes(16).toString('hex').toUpperCase();
  const grant = async (token: string, tx = txId(), adUnit = '1234567890') => {
    const { data, error } = await admin.rpc('grant_ad_reward', { p_token_hash: hashOf(token), p_transaction_id: tx, p_ad_unit: adUnit });
    expect(error).toBeNull();
    return data as string;
  };
  const credits = async (user: TestUser, type?: string) => {
    let query = admin.from('ad_credits').select('reward_type, credits, quota_day, transaction_id').eq('user_id', user.id);
    if (type) query = query.eq('reward_type', type);
    return (await query).data ?? [];
  };
  const logFood = (user: TestUser) =>
    user.client.from('food_logs').insert({ id: crypto.randomUUID(), user_id: user.id, log_date: utcToday(), food_id: sharedFoodId, quantity: 1, meal_type: 'lunch' });

  it('credits the configured food bonus (+2) to the token owner for today', async () => {
    const user = await freshUser();
    const { token, outcome } = await issue(user, 'food');

    expect(outcome).toBe('issued');
    expect(await grant(token)).toBe('granted');

    expect(await credits(user)).toEqual([expect.objectContaining({ reward_type: 'food', credits: 2, quota_day: utcToday() })]);
  });

  it('credits the configured AI bonus (+1)', async () => {
    const user = await freshUser();
    const { token } = await issue(user, 'ai');

    expect(await grant(token)).toBe('granted');

    expect(await credits(user)).toEqual([expect.objectContaining({ reward_type: 'ai', credits: 1 })]);
  });

  it('takes the bonus size from app_config, not from the code', async () => {
    const user = await freshUser();
    await setConfig('ad_reward_food_logs', 5);
    const { token } = await issue(user, 'food');

    expect(await grant(token)).toBe('granted');
    await setConfig('ad_reward_food_logs', original.ad_reward_food_logs);

    expect((await credits(user, 'food'))[0].credits).toBe(5);
  });

  it('shows the verified credit in the limit read model', async () => {
    const user = await freshUser();
    const before = (await callFunction('check-limit', user.jwt, {})).json;

    await grant((await issue(user, 'food')).token);

    // Only relative checks: other suites briefly change the free limit while running in parallel, and the
    // food gate's use of ad credits is covered by food-quota.test.ts.
    const after = (await callFunction('check-limit', user.jwt, {})).json;
    expect(after.food.bonus).toBe(before.food.bonus + 2);
    expect(after.adRewards.used).toBe(before.adRewards.used + 1);
    expect(after.adRewards.remaining).toBe(before.adRewards.remaining - 1);
  });

  it('grants nothing for an unknown token', async () => {
    const user = await freshUser();

    expect(await grant(newToken())).toBe('unknown_token');
    expect(await credits(user)).toEqual([]);
  });

  it('grants nothing for an expired token', async () => {
    const user = await freshUser();
    const token = newToken();
    await admin.from('ad_reward_requests').insert({ token_hash: hashOf(token), user_id: user.id, reward_type: 'food', expires_at: new Date(Date.now() - 1000).toISOString() });

    expect(await grant(token)).toBe('expired');
    expect(await credits(user)).toEqual([]);
  });

  it('accepts a token only once and treats the same transaction again as a duplicate', async () => {
    const user = await freshUser();
    const { token } = await issue(user, 'food');
    const tx = txId();

    expect(await grant(token, tx)).toBe('granted');
    expect(await grant(token, tx)).toBe('duplicate');
    expect(await grant(token, txId())).toBe('token_used');

    expect(await credits(user)).toHaveLength(1);
  });

  it('rejects a replayed transaction id under a different token, leaving that token unused', async () => {
    const user = await freshUser();
    const first = (await issue(user, 'food')).token;
    const second = (await issue(user, 'food')).token;
    const tx = txId();
    await grant(first, tx);

    expect(await grant(second, tx)).toBe('duplicate');

    expect(await credits(user)).toHaveLength(1);
    expect((await admin.from('ad_reward_requests').select('consumed_at').eq('token_hash', hashOf(second)).single()).data?.consumed_at).toBeNull();
  });

  it('enforces the daily cap from app_config on the server', async () => {
    const user = await freshUser();
    const tokens = [];
    for (let i = 0; i < 4; i++) tokens.push((await issue(user, 'food')).token);

    expect(await grant(tokens[0])).toBe('granted');
    expect(await grant(tokens[1])).toBe('granted');
    expect(await grant(tokens[2])).toBe('granted');
    expect(await grant(tokens[3])).toBe('cap_reached');

    expect(await credits(user)).toHaveLength(3);
  });

  it('follows a changed cap', async () => {
    const user = await freshUser();
    await setConfig('ad_rewards_max_per_day', 1);
    try {
      const a = (await issue(user, 'food')).token;
      const b = (await issue(user, 'ai')).token;

      expect(await grant(a)).toBe('granted');
      expect(await grant(b)).toBe('cap_reached');
    } finally {
      await setConfig('ad_rewards_max_per_day', original.ad_rewards_max_per_day);
    }
  });

  it('lets exactly three of four concurrent callbacks through', async () => {
    const user = await freshUser();
    const tokens = await Promise.all([1, 2, 3, 4].map(async () => (await issue(user, 'food')).token));

    const outcomes = await Promise.all(tokens.map((token) => grant(token)));

    expect(outcomes.filter((o) => o === 'granted')).toHaveLength(3);
    expect(outcomes.filter((o) => o === 'cap_reached')).toHaveLength(1);
    expect(await credits(user)).toHaveLength(3);
  });

  it('credits once when the same token is used by concurrent callbacks', async () => {
    const user = await freshUser();
    const { token } = await issue(user, 'food');

    const outcomes = await Promise.all([grant(token), grant(token), grant(token)]);

    expect(outcomes.filter((o) => o === 'granted')).toHaveLength(1);
    expect(await credits(user)).toHaveLength(1);
  });

  it('credits once when the same transaction arrives concurrently under two tokens', async () => {
    const user = await freshUser();
    const tx = txId();
    const tokens = await Promise.all([1, 2].map(async () => (await issue(user, 'food')).token));

    const outcomes = await Promise.all(tokens.map((token) => grant(token, tx)));

    expect(outcomes.filter((o) => o === 'granted')).toHaveLength(1);
    expect(await credits(user)).toHaveLength(1);
  });

  it('credits only the account the token was issued to', async () => {
    const a = await freshUser();
    const b = await freshUser();
    const { token } = await issue(a, 'food');

    expect(await grant(token)).toBe('granted');

    expect(await credits(a)).toHaveLength(1);
    expect(await credits(b)).toEqual([]);
    expect((await b.client.from('ad_credits').select('id')).data).toEqual([]);
    expect((await a.client.from('ad_credits').select('id')).data).toHaveLength(1);
  });

  it('still credits when the reward arrives after the app has closed (no client session involved)', async () => {
    const user = await freshUser();
    const { token } = await issue(user, 'ai', newToken(), 900);
    // The app is gone: nothing below touches a client, only the server-side callback.

    expect(await grant(token)).toBe('granted');
    expect(await credits(user, 'ai')).toHaveLength(1);
  });

  it('gives premium users no ad rewards, even for a token issued before they upgraded', async () => {
    const premium = await freshUser();
    await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', premium.id);
    expect((await issue(premium, 'food')).outcome).toBe('premium');

    const user = await freshUser();
    const { token } = await issue(user, 'food');
    await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', user.id);

    expect(await grant(token)).toBe('premium');
    expect(await credits(user)).toEqual([]);
  });

  it('refuses to issue a token once the daily cap is used', async () => {
    const user = await freshUser();
    for (let i = 0; i < 3; i++) await grant((await issue(user, 'food')).token);

    expect((await issue(user, 'food')).outcome).toBe('cap_reached');
  });

  it('keeps only a few unused tokens per user, newest first, so requests cannot pile up', async () => {
    const user = await freshUser();
    const tokens: string[] = [];
    for (let i = 0; i < 8; i++) tokens.push((await issue(user, 'food')).token);

    const { data } = await admin.from('ad_reward_requests').select('token_hash').eq('user_id', user.id).is('consumed_at', null);

    expect((data ?? []).length).toBeLessThanOrEqual(5);
    expect(await grant(tokens[7])).toBe('granted'); // the newest token still works
    expect(await grant(tokens[0])).toBe('unknown_token'); // the oldest was dropped
  });

  it('keeps clients away from the request table, the ledger writes and both functions', async () => {
    const user = await freshUser();
    const { token } = await issue(user, 'food');

    expect((await user.client.from('ad_reward_requests').select('*')).data ?? []).toEqual([]);
    expect((await user.client.from('ad_reward_requests').insert({ token_hash: hashOf('x'), user_id: user.id, reward_type: 'food', expires_at: new Date().toISOString() })).error).not.toBeNull();
    expect((await user.client.from('ad_credits').insert({ user_id: user.id, reward_type: 'food', credits: 50, quota_day: utcToday() })).error).not.toBeNull();
    expect((await user.client.rpc('grant_ad_reward', { p_token_hash: hashOf(token), p_transaction_id: txId(), p_ad_unit: '1' })).error).not.toBeNull();
    expect((await user.client.rpc('request_ad_reward', { p_user_id: user.id, p_reward_type: 'food', p_token_hash: hashOf('y'), p_ttl_seconds: 900 })).error).not.toBeNull();
    expect(await credits(user)).toEqual([]);
  });

  describe('request-ad-reward function', () => {
    it('requires a signed-in user', async () => {
      expect((await callFunction('request-ad-reward', undefined, { rewardType: 'food' })).status).toBe(401);
    });

    it('rejects an unknown reward type', async () => {
      const user = await freshUser();

      expect((await callFunction('request-ad-reward', user.jwt, { rewardType: 'gold' })).status).toBe(400);
      expect((await callFunction('request-ad-reward', user.jwt, {})).status).toBe(400);
    });

    it('issues an opaque short-lived token bound to the caller and the reward type, storing only its hash', async () => {
      const user = await freshUser();

      const { status, json } = await callFunction('request-ad-reward', user.jwt, { rewardType: 'ai', userId: 'someone-else' });

      expect(status).toBe(200);
      expect(typeof json.token).toBe('string');
      expect(json.token.length).toBeGreaterThanOrEqual(32);
      const ttl = Date.parse(json.expiresAt) - Date.now();
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000);
      const { data } = await admin.from('ad_reward_requests').select('user_id, reward_type, token_hash').eq('user_id', user.id);
      expect(data).toEqual([{ user_id: user.id, reward_type: 'ai', token_hash: hashOf(json.token) }]);
      expect(JSON.stringify(data)).not.toContain(json.token);
      expect(await grant(json.token)).toBe('granted');
      expect(await credits(user, 'ai')).toHaveLength(1);
    });

    it('issues different tokens each time', async () => {
      const user = await freshUser();

      const one = (await callFunction('request-ad-reward', user.jwt, { rewardType: 'food' })).json.token;
      const two = (await callFunction('request-ad-reward', user.jwt, { rewardType: 'food' })).json.token;

      expect(one).not.toBe(two);
    });

    it('tells premium users 409 and users at the cap 429, issuing nothing', async () => {
      const premium = await freshUser();
      await admin.from('entitlements').update({ tier: 'premium' }).eq('user_id', premium.id);
      const capped = await freshUser();
      for (let i = 0; i < 3; i++) await grant((await issue(capped, 'food')).token);

      expect((await callFunction('request-ad-reward', premium.jwt, { rewardType: 'food' })).status).toBe(409);
      expect((await callFunction('request-ad-reward', capped.jwt, { rewardType: 'food' })).status).toBe(429);
      expect((await admin.from('ad_reward_requests').select('token_hash').eq('user_id', premium.id)).data).toEqual([]);
    });
  });

  describe('grant-ad-reward function (deployed)', () => {
    // Google sends a plain GET with no Authorization or apikey header.
    const callback = (query: string) => nodeFetch(`${supabaseUrl}/functions/v1/grant-ad-reward${query}`, { method: 'GET' });

    it('rejects an unsigned or forged callback without any credentials, and credits nothing', async () => {
      const user = await freshUser();
      const { token } = await issue(user, 'food');
      const forged = `?ad_network=1&ad_unit=1234567890&custom_data=${token}&reward_amount=1&reward_item=r&timestamp=1&transaction_id=${txId()}&signature=MEUCIQDforged&key_id=3335741209`;

      const res = await callback(forged);

      expect([400, 403, 503]).toContain(res.status);
      expect((await callback('')).status).not.toBe(200);
      expect((await callback(`?custom_data=${token}`)).status).not.toBe(200);
      expect(await credits(user)).toEqual([]);
      expect((await admin.from('ad_reward_requests').select('consumed_at').eq('token_hash', hashOf(token)).single()).data?.consumed_at).toBeNull();
    });
  });
});
