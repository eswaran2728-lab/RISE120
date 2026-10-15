// Reads the bounded context the coach may see, for one account, with the service role. The user id must come from
// a verified token. Columns are listed explicitly so a name, food preference, picture path or plan id can never
// be read by accident, and only the member's own rows are requested.
import type { PlanWorkout } from '../plan/types.ts';
import { resolveLanguage } from './prompt.ts';
import { COACH_BOUNDS, COACH_LIMITS, CoachCheckin, CoachContext, CoachExercise, CoachPlanDay, CoachProfile } from './types.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

const PLAN_LENGTH = 120;
const DAY_MS = 86400000;
const utcDay = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

function toProfile(row: Record<string, unknown> | null): CoachProfile | null {
  if (!row) return null;
  const { goal, training_level: level, equipment } = row;
  const weight = num(row.weight_kg);
  const height = num(row.height_cm);
  const age = num(row.age);
  if (!goal || !level || !equipment || weight === null || height === null || age === null) return null;
  return {
    goal: goal as CoachProfile['goal'],
    trainingLevel: level as CoachProfile['trainingLevel'],
    equipment: equipment as CoachProfile['equipment'],
    weightKg: weight,
    heightCm: height,
    age,
    energySex: (row.energy_sex as CoachProfile['energySex']) ?? null,
    activityLevel: (row.activity_level as CoachProfile['activityLevel']) ?? null,
  };
}

// How many plan days this account may open now: all of them for a premium member, otherwise the server-configured
// free days. Anything unreadable fails closed to zero days (no proposals).
async function accessibleDays(db: Db, userId: string): Promise<number> {
  const premium = await db.rpc('is_premium_now', { p_user_id: userId });
  if (!premium.error && premium.data === true) return PLAN_LENGTH;
  const config = await db.from('app_config').select('key, value').eq('key', 'free_plan_days').maybeSingle();
  const value = config.data?.value;
  return !config.error && Number.isInteger(value) && value >= 0 ? Math.min(value, PLAN_LENGTH) : 0;
}

export async function loadCoachContext(db: Db, userId: string, now: Date = new Date()): Promise<CoachContext> {
  const profileRow = await db
    .from('profiles')
    .select('language, goal, training_level, equipment, weight_kg, height_cm, age, energy_sex, activity_level')
    .eq('id', userId)
    .maybeSingle();
  const { language, fellBack } = resolveLanguage(profileRow.data?.language);
  const profile = toProfile(profileRow.data ?? null);

  const checkinRows = await db
    .from('checkins')
    .select('checkin_date, weight_kg, mood, sleep_hours')
    .eq('user_id', userId)
    .order('checkin_date', { ascending: false })
    .limit(COACH_LIMITS.maxCheckins);
  const checkins: CoachCheckin[] = ((checkinRows.data ?? []) as Record<string, unknown>[]).slice(0, COACH_LIMITS.maxCheckins).map((row) => ({
    date: row.checkin_date as string,
    weightKg: num(row.weight_kg),
    mood: num(row.mood),
    sleepHours: num(row.sleep_hours),
  }));

  const empty: CoachContext = { language, languageFellBack: fellBack, profile, checkins, todayDayNumber: null, planDays: [], exercises: [] };
  if (!profile) return empty;

  const exerciseRows = await db.from('exercises').select('id, name, muscle_group, equipment').eq('equipment', profile.equipment).order('name');
  const exercises: CoachExercise[] = ((exerciseRows.data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    pattern: row.muscle_group as string,
    equipment: row.equipment as string,
  }));

  const plan = await db.from('plans').select('id, start_date').eq('user_id', userId).maybeSingle();
  if (!plan.data) return { ...empty, exercises };

  const today = now.toISOString().slice(0, 10);
  const todayDayNumber = utcDay(today) - utcDay(plan.data.start_date as string) + 1;
  const first = Math.max(1, todayDayNumber + COACH_BOUNDS.earliestOffsetDays);
  const last = Math.min(PLAN_LENGTH, await accessibleDays(db, userId), todayDayNumber + COACH_LIMITS.horizonDays);
  if (first > last) return { ...empty, exercises, todayDayNumber };

  const dayRows = await db
    .from('plan_days')
    .select('day_number, workout, calorie_target, protein_target_g')
    .eq('user_id', userId)
    .eq('plan_id', plan.data.id)
    .gte('day_number', first)
    .lte('day_number', last)
    .order('day_number');
  const planDays: CoachPlanDay[] = ((dayRows.data ?? []) as Record<string, unknown>[]).map((row) => ({
    dayNumber: row.day_number as number,
    date: addDays(plan.data.start_date as string, (row.day_number as number) - 1),
    workout: ((row.workout as PlanWorkout | null) ?? { kind: 'rest' }) as PlanWorkout,
    calorieTarget: num(row.calorie_target),
    proteinTargetG: num(row.protein_target_g),
  }));

  return { ...empty, exercises, todayDayNumber, planDays };
}
