// Creates the caller's 120-day plan. Safe to call repeatedly: one plan per user, and a retry
// only fills in missing days. Deploy with:
//   npx supabase functions deploy generate-plan --project-ref <ref> --no-verify-jwt
// The JWT is verified here (like delete-account); the user id comes only from it, never the body.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildPlanDays, NUTRITION_RULES } from '../_shared/plan/generate.ts';
import type { PlanProfile } from '../_shared/plan/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// The client sends its local calendar date, which can differ from UTC by up to about a day.
function isPlausibleStartDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) return false;
  return Math.abs(parsed - Date.now()) <= 2 * 24 * 60 * 60 * 1000;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'Unauthorized' }, 401);
  const userId = auth.user.id;

  const body = await req.json().catch(() => ({}));
  if (!isPlausibleStartDate(body?.startDate)) return json({ error: 'Invalid startDate' }, 400);

  const { data: row, error: profileError } = await admin
    .from('profiles')
    .select('age, height_cm, weight_kg, goal, training_level, equipment, energy_sex, activity_level, onboarded_at')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) return json({ error: 'Could not read profile' }, 500);
  if (
    !row || !row.onboarded_at || row.age == null || row.height_cm == null || row.weight_kg == null ||
    !row.goal || !row.training_level || !row.equipment
  ) {
    return json({ error: 'Profile is incomplete' }, 422);
  }

  const { data: exercises, error: exerciseError } = await admin
    .from('exercises')
    .select('id, name, muscle_group, equipment, instructions');
  if (exerciseError || !exercises) return json({ error: 'Could not read exercises' }, 500);

  const profile: PlanProfile = {
    age: row.age,
    heightCm: Number(row.height_cm),
    weightKg: Number(row.weight_kg),
    goal: row.goal,
    trainingLevel: row.training_level,
    equipment: row.equipment,
    energySex: row.energy_sex,
    activityLevel: row.activity_level,
  };

  let days;
  try {
    days = buildPlanDays(profile, body.startDate, exercises, NUTRITION_RULES);
  } catch {
    return json({ error: 'Could not build plan' }, 500);
  }

  const payload = days.map(({ date: _date, ...day }) => day);
  const { data, error } = await admin.rpc('create_plan_with_days', {
    p_user_id: userId,
    p_start_date: body.startDate,
    p_days: payload,
  });
  if (error || !data?.[0]) return json({ error: 'Could not save plan' }, 500);

  return json({ planId: data[0].result_plan_id, created: data[0].was_created }, 200);
});
