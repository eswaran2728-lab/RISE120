import fs from 'fs';
import path from 'path';
import https from 'https';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const envPath = path.resolve(__dirname, '../../.env.test');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let val = match[2]?.trim() || '';
      if (/^(".*"|'.*')$/.test(val)) val = val.slice(1, -1);
      process.env[match[1]] = process.env[match[1]] || val;
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, or SUPABASE_SERVICE_ROLE_KEY in .env.test');
}

// jest-expo mocks global fetch, so talk to Supabase through Node's https.
function nodeFetch(url: any, options: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(typeof url === 'string' ? url : (url?.url ?? url?.toString?.()));
    const headers: Record<string, any> = {};
    if (options.headers) {
      if (typeof options.headers.forEach === 'function') options.headers.forEach((v: any, k: string) => (headers[k] = v));
      else Object.assign(headers, options.headers);
    }
    const req = https.request(parsed, { method: options.method || 'GET', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 500;
        resolve({
          status,
          statusText: res.statusMessage,
          ok: status >= 200 && status < 300,
          headers: {
            get: (name: string) => (res.headers[name.toLowerCase()] as string) ?? null,
            has: (name: string) => name.toLowerCase() in res.headers,
          },
          text: async () => bodyText,
          json: async () => JSON.parse(bodyText || '{}'),
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const memoryStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const createTestClient = (key: string) =>
  createClient(supabaseUrl, key, {
    auth: { storage: memoryStorage, autoRefreshToken: false, persistSession: false },
    global: { fetch: nodeFetch },
  });

async function callDeleteAccount(jwt?: string, body?: object) {
  const response = await nodeFetch(`${supabaseUrl}/functions/v1/delete-account`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status as number, json: await response.json().catch(() => ({})) };
}

const USER_TABLES: Array<[string, string]> = [
  ['profiles', 'id'],
  ['entitlements', 'user_id'],
  ['checkins', 'user_id'],
  ['workout_logs', 'user_id'],
];

jest.setTimeout(60000);

describe('delete-account edge function', () => {
  let admin: SupabaseClient;
  let userAId: string;
  let userBId: string;
  let jwtA: string;
  let exerciseId: string;
  const password = 'TestPassword123!';

  const seedUserRows = async (userId: string) => {
    const { error: checkinError } = await admin
      .from('checkins')
      .insert({ user_id: userId, checkin_date: '2026-10-12', weight_kg: 70 });
    expect(checkinError).toBeNull();
    const { error: logError } = await admin.from('workout_logs').insert({
      user_id: userId,
      log_date: '2026-10-12',
      exercise_id: exerciseId,
      set_number: 1,
      reps: 10,
      weight_kg: 20,
    });
    expect(logError).toBeNull();
  };

  const countRows = async (table: string, column: string, userId: string) => {
    const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq(column, userId);
    expect(error).toBeNull();
    return count ?? 0;
  };

  beforeAll(async () => {
    admin = createTestClient(serviceRoleKey);
    const suffix = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const emailA = `delete-a-${suffix}@example.com`;
    const created = await Promise.all(
      [emailA, `delete-b-${suffix}@example.com`].map((email) =>
        admin.auth.admin.createUser({ email, password, email_confirm: true })
      )
    );
    if (created.some(({ error }) => error)) throw new Error('Failed to create test users');
    userAId = created[0].data.user!.id;
    userBId = created[1].data.user!.id;

    const userClient = createTestClient(publishableKey);
    const { data: session, error } = await userClient.auth.signInWithPassword({ email: emailA, password });
    if (error || !session.session) throw new Error(`Failed to sign in user A: ${error?.message}`);
    jwtA = session.session.access_token;

    const { data: exercise, error: exerciseError } = await admin
      .from('exercises')
      .insert({ name: 'delete-account test', muscle_group: 'test', equipment: 'none', instructions: 'test' })
      .select('id')
      .single();
    if (exerciseError || !exercise) throw new Error(`Failed to seed exercise: ${exerciseError?.message}`);
    exerciseId = exercise.id;

    await seedUserRows(userAId);
    await seedUserRows(userBId);
  });

  afterAll(async () => {
    if (!admin) return;
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
    if (exerciseId) await admin.from('exercises').delete().eq('id', exerciseId);
  });

  test('a call with no JWT returns 401 and deletes nothing', async () => {
    const { status } = await callDeleteAccount(undefined, { userId: userBId });

    expect(status).toBe(401);
    expect(await countRows('profiles', 'id', userBId)).toBe(1);
  });

  test('deleting as A removes only A, using the JWT user and ignoring any id in the body', async () => {
    const { status, json } = await callDeleteAccount(jwtA, { userId: userBId });

    expect(status).toBe(200);
    expect(json).toEqual({ deleted: true });

    const { data: gone } = await admin.auth.admin.getUserById(userAId);
    expect(gone.user).toBeNull();
    for (const [table, column] of USER_TABLES) {
      expect(await countRows(table, column, userAId)).toBe(0);
    }

    const { data: stillThere } = await admin.auth.admin.getUserById(userBId);
    expect(stillThere.user?.id).toBe(userBId);
    for (const [table, column] of USER_TABLES) {
      expect(await countRows(table, column, userBId)).toBe(1);
    }
  });
});
