// Starts the caller's next 120-day cycle (progression or maintenance). Deploy with:
//   npx supabase functions deploy start-next-cycle --project-ref <ref> --no-verify-jwt --use-api
// The JWT is verified here and the account comes only from it. The body carries a request id, a mode and the
// member's local date; the plan itself is built here from the stored profile, never taken from the request. The
// database function completes the finished cycle and creates the new one in one transaction, and the same request
// id always gets the same cycle back.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseCycleRequest, profileForMode } from '../_shared/plan/cycle.ts';
import { buildPlanDays, NUTRITION_RULES } from '../_shared/plan/generate.ts';
import type { PlanProfile } from '../_shared/plan/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
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

  const request = parseCycleRequest(await req.json().catch(() => null));
  if (!request.ok) return json({ error: 'invalid_request' }, 400);

  const { data: row, error: profileError } = await admin
    .from('profiles')
    .select('age, height_cm, weight_kg, goal, training_level, equipment, energy_sex, activity_level, onboarded_at, journey_time_zone')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) return json({ error: 'Could not read profile' }, 500);
  if (!row || !row.onboarded_at || row.age == null || row.height_cm == null || row.weight_kg == null || !row.goal || !row.training_level || !row.equipment) {
    return json({ error: 'Profile is incomplete' }, 422);
  }

  const { data: exercises, error: exerciseError } = await admin.from('exercises').select('id, name, muscle_group, equipment, instructions');
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
    days = buildPlanDays(profileForMode(profile, request.mode), request.startDate, exercises, NUTRITION_RULES);
  } catch {
    return json({ error: 'Could not build plan' }, 500);
  }

  const { data, error } = await admin.rpc('start_next_cycle', {
    p_user_id: userId,
    p_request_id: request.requestId,
    p_mode: request.mode,
    p_start_date: request.startDate,
    p_days: days.map(({ date: _date, ...day }) => day),
    p_journey_time_zone: row.journey_time_zone ?? null,
  });
  if (error) {
    const text = `${error.message ?? ''}`;
    if (text.includes('NO_ACTIVE_PLAN')) return json({ error: 'NO_ACTIVE_PLAN' }, 404);
    if (text.includes('CYCLE_NOT_FINISHED')) return json({ error: 'CYCLE_NOT_FINISHED' }, 409);
    if (text.includes('INVALID_START_DATE')) return json({ error: 'invalid_request' }, 400);
    return json({ error: 'Could not start the next cycle' }, 500);
  }
  const result = data?.[0];
  if (!result) return json({ error: 'Could not start the next cycle' }, 500);

  return json({ planId: result.result_plan_id, created: result.was_created, cycleNumber: result.result_cycle_number }, 200);
});
