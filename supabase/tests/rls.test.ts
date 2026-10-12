import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Load .env.test if present
const envPath = path.resolve(__dirname, '../../.env.test');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let val = match[2]?.trim() || '';
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      process.env[key] = process.env[key] || val;
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, or SUPABASE_SERVICE_ROLE_KEY in .env.test');
}

// In React Native / jest-expo environment, global.fetch is mocked.
// Provide a real Node https fetcher so tests can communicate with Supabase.
function nodeFetch(url: any, options: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const rawUrl = typeof url === 'string' ? url : url?.url ? url.url : url?.toString?.();
    const parsed = new URL(rawUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const headers: Record<string, any> = {};
    if (options.headers) {
      if (typeof options.headers.forEach === 'function') {
        options.headers.forEach((v: any, k: string) => {
          headers[k] = v;
        });
      } else {
        Object.assign(headers, options.headers);
      }
    }
    const req = lib.request(
      parsed,
      {
        method: options.method || 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const bodyText = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            statusText: res.statusMessage,
            ok: (res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300,
            headers: {
              get: (name: string) => (res.headers[name.toLowerCase()] as string) ?? null,
              has: (name: string) => name.toLowerCase() in res.headers,
            },
            text: async () => bodyText,
            json: async () => JSON.parse(bodyText || '{}'),
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const memoryStorage = {
  getItem: (_key: string) => null,
  setItem: (_key: string, _value: string) => {},
  removeItem: (_key: string) => {},
};

const createTestClient = (key: string) =>
  createClient(supabaseUrl, key, {
    auth: { storage: memoryStorage, autoRefreshToken: false, persistSession: false },
    global: { fetch: nodeFetch },
  });

jest.setTimeout(30000);

describe('Rise120 Row-Level Security (RLS) & Trigger Tests', () => {
  let adminClient: SupabaseClient;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    adminClient = createTestClient(serviceRoleKey);

    const timestamp = Date.now();
    const emailA = `test-a-${timestamp}-${Math.random().toString(36).substring(7)}@example.com`;
    const emailB = `test-b-${timestamp}-${Math.random().toString(36).substring(7)}@example.com`;
    const password = 'TestPassword123!';

    const { data: authA, error: errA } = await adminClient.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
    });
    if (errA || !authA.user) throw new Error(`Failed to create test user A: ${errA?.message}`);
    userAId = authA.user.id;

    const { data: authB, error: errB } = await adminClient.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
    });
    if (errB || !authB.user) throw new Error(`Failed to create test user B: ${errB?.message}`);
    userBId = authB.user.id;

    clientA = createTestClient(publishableKey);
    const { error: signInErrA } = await clientA.auth.signInWithPassword({ email: emailA, password });
    if (signInErrA) throw new Error(`Failed to sign in user A: ${signInErrA.message}`);

    clientB = createTestClient(publishableKey);
    const { error: signInErrB } = await clientB.auth.signInWithPassword({ email: emailB, password });
    if (signInErrB) throw new Error(`Failed to sign in user B: ${signInErrB.message}`);
  });

  afterAll(async () => {
    if (adminClient) {
      if (userAId) await adminClient.auth.admin.deleteUser(userAId);
      if (userBId) await adminClient.auth.admin.deleteUser(userBId);
    }
  });

  test('new signup gets one profile and one free entitlement (trigger check)', async () => {
    const { data: profile, error: profErr } = await adminClient
      .from('profiles')
      .select('id')
      .eq('id', userAId)
      .single();
    expect(profErr).toBeNull();
    expect(profile?.id).toBe(userAId);

    const { data: entitlement, error: entErr } = await adminClient
      .from('entitlements')
      .select('user_id, tier')
      .eq('user_id', userAId)
      .single();
    expect(entErr).toBeNull();
    expect(entitlement?.user_id).toBe(userAId);
    expect(entitlement?.tier).toBe('free');
  });

  test("user B cannot read user A's profile -> empty result", async () => {
    const { data, error } = await clientB
      .from('profiles')
      .select('*')
      .eq('id', userAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test("user B cannot update user A's checkin -> zero rows affected", async () => {
    const { error: insErr } = await adminClient
      .from('checkins')
      .insert({
        user_id: userAId,
        checkin_date: '2026-10-12',
        weight_kg: 75,
      });
    expect(insErr).toBeNull();

    const { data } = await clientB
      .from('checkins')
      .update({ weight_kg: 85 })
      .eq('user_id', userAId)
      .select();

    expect(data ?? []).toEqual([]);

    const { data: checkin } = await adminClient
      .from('checkins')
      .select('weight_kg')
      .eq('user_id', userAId)
      .single();
    expect(Number(checkin?.weight_kg)).toBe(75);
  });

  test('user cannot upgrade own entitlement: A updates own entitlements.tier to premium -> error or zero rows, and a service-role read still shows free', async () => {
    const { data } = await clientA
      .from('entitlements')
      .update({ tier: 'premium' })
      .eq('user_id', userAId)
      .select();

    expect(data ?? []).toEqual([]);

    const { data: entitlement, error: entErr } = await adminClient
      .from('entitlements')
      .select('tier')
      .eq('user_id', userAId)
      .single();
    expect(entErr).toBeNull();
    expect(entitlement?.tier).toBe('free');
  });

  test('user cannot write usage_daily -> insert rejected', async () => {
    const { data, error } = await clientA
      .from('usage_daily')
      .insert({
        user_id: userAId,
        usage_date: '2026-10-12',
        food_logs: 1,
      })
      .select();

    expect(error).not.toBeNull();
    expect(data ?? []).toEqual([]);
  });

  test('user cannot edit app_config -> write rejected', async () => {
    const { data } = await clientA
      .from('app_config')
      .update({ value: 999 })
      .eq('key', 'free_plan_days')
      .select();

    expect(data ?? []).toEqual([]);

    const { error: insErr } = await clientA
      .from('app_config')
      .insert({ key: 'hack', value: 1 });
    expect(insErr).not.toBeNull();
  });

  test('user can create a custom food but not a verified one -> insert with verified = true rejected', async () => {
    // Verified = true must be rejected
    const { data: vData, error: vErr } = await clientA
      .from('foods')
      .insert({
        user_id: userAId,
        name: 'Sneaky Superfood',
        serving_desc: '100g',
        calories: 100,
        protein_g: 10,
        carbs_g: 10,
        fat_g: 2,
        source: 'user',
        verified: true,
      })
      .select();
    expect(vErr).not.toBeNull();
    expect(vData ?? []).toEqual([]);

    // Custom food with verified = false should be created
    const { data: cData, error: cErr } = await clientA
      .from('foods')
      .insert({
        user_id: userAId,
        name: 'Custom Oatmeal',
        serving_desc: '1 bowl',
        calories: 150,
        protein_g: 5,
        carbs_g: 27,
        fat_g: 3,
        source: 'user',
        verified: false,
      })
      .select();
    expect(cErr).toBeNull();
    expect(cData?.[0]?.name).toBe('Custom Oatmeal');
  });

  test("shared foods are readable, other users' custom foods are not", async () => {
    const sharedFoodName = `Shared Banana ${Date.now()}`;
    const { error: sharedErr } = await adminClient
      .from('foods')
      .insert({
        user_id: null,
        name: sharedFoodName,
        serving_desc: '1 medium',
        calories: 105,
        protein_g: 1.3,
        carbs_g: 27,
        fat_g: 0.3,
        source: 'usda',
        verified: true,
      });
    expect(sharedErr).toBeNull();

    const { data: foodsB, error: readErrB } = await clientB
      .from('foods')
      .select('*');
    expect(readErrB).toBeNull();

    const foundShared = foodsB?.some((f) => f.name === sharedFoodName);
    const foundUserACustom = foodsB?.some((f) => f.name === 'Custom Oatmeal');
    expect(foundShared).toBe(true);
    expect(foundUserACustom).toBe(false);

    await adminClient.from('foods').delete().eq('name', sharedFoodName);
  });

  test('signed-in users can read app_config and exercises, but cannot delete profiles', async () => {
    const { data: configs, error: configErr } = await clientA
      .from('app_config')
      .select('*');
    expect(configErr).toBeNull();
    expect(configs?.length).toBeGreaterThanOrEqual(6);

    const { data: exercises, error: exErr } = await clientA
      .from('exercises')
      .select('*');
    expect(exErr).toBeNull();

    const { data: delData } = await clientA
      .from('profiles')
      .delete()
      .eq('id', userAId)
      .select();
    expect(delData ?? []).toEqual([]);

    const { data: profAfter } = await adminClient
      .from('profiles')
      .select('id')
      .eq('id', userAId)
      .single();
    expect(profAfter?.id).toBe(userAId);
  });
});
