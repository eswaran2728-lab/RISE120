// Shared helpers for live Supabase tests (Phase 2 onward). Not a test file.
// Needs an untracked .env.test with SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and
// SUPABASE_SERVICE_ROLE_KEY for the Rise120 DEVELOPMENT project.
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

export const supabaseUrl = process.env.SUPABASE_URL as string;
export const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY as string;
export const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, or SUPABASE_SERVICE_ROLE_KEY in .env.test');
}

// jest-expo mocks global fetch, so talk to Supabase through Node's https.
export function nodeFetch(url: any, options: any = {}): Promise<any> {
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
        const body = Buffer.concat(chunks);
        const status = res.statusCode ?? 500;
        resolve({
          status,
          statusText: res.statusMessage,
          ok: status >= 200 && status < 300,
          headers: {
            get: (name: string) => (res.headers[name.toLowerCase()] as string) ?? null,
            has: (name: string) => name.toLowerCase() in res.headers,
          },
          text: async () => body.toString('utf8'),
          json: async () => JSON.parse(body.toString('utf8') || '{}'),
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
          blob: async () => new Blob([body]),
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const memoryStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

export const createTestClient = (key: string): SupabaseClient =>
  createClient(supabaseUrl, key, {
    auth: { storage: memoryStorage, autoRefreshToken: false, persistSession: false },
    global: { fetch: nodeFetch },
  });

export const createAdmin = (): SupabaseClient => createTestClient(serviceRoleKey);

export type TestUser = { id: string; email: string; client: SupabaseClient; jwt: string };

// Creates a confirmed user (the signup trigger adds profile + entitlement) and signs in.
export async function createTestUser(admin: SupabaseClient, label: string): Promise<TestUser> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;
  const password = 'TestPassword123!';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`);
  const client = createTestClient(publishableKey);
  const { data: session, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !session.session) throw new Error(`Failed to sign in test user: ${signInError?.message}`);
  return { id: data.user.id, email, client, jwt: session.session.access_token };
}

export async function callFunction(name: string, jwt?: string, body?: object) {
  const response = await nodeFetch(`${supabaseUrl}/functions/v1/${name}`, {
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
