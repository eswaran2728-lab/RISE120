import { loadCoachContext } from '../functions/_shared/coach/context';
import { COACH_LIMITS } from '../functions/_shared/coach/types';
import { exercises as catalogue, EX, workoutEntries } from './coach-fixtures';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
// The plan starts 2026-10-16, so "now" 2026-10-18T12:00Z is plan day 3.
const NOW = new Date('2026-10-18T12:00:00Z');
const START = '2026-10-16';

type Row = Record<string, unknown>;

// A small stand-in for the Supabase client that, like PostgREST, returns only the columns that were selected.
function fakeDb(tables: Record<string, Row[]>, options: { premium?: boolean; premiumError?: boolean } = {}) {
  const selects: { table: string; columns: string }[] = [];
  const reads: string[] = [];
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let columns = '*';
    let limit: number | null = null;
    const builder: Record<string, unknown> = {
      select: (cols: string) => {
        columns = cols;
        selects.push({ table, columns: cols });
        return builder;
      },
      eq: (col: string, val: unknown) => ((rows = rows.filter((r) => r[col] === val)), builder),
      gte: (col: string, val: number) => ((rows = rows.filter((r) => (r[col] as number) >= val)), builder),
      lte: (col: string, val: number) => ((rows = rows.filter((r) => (r[col] as number) <= val)), builder),
      order: (col: string, o?: { ascending?: boolean }) => {
        const dir = o?.ascending === false ? -1 : 1;
        rows.sort((a, b) => (a[col]! > b[col]! ? dir : a[col]! < b[col]! ? -dir : 0));
        return builder;
      },
      limit: (n: number) => ((limit = n), builder),
    };
    const result = () => {
      reads.push(table);
      let out = limit === null ? rows : rows.slice(0, limit);
      if (columns !== '*') {
        const wanted = columns.split(',').map((c) => c.trim());
        out = out.map((r) => Object.fromEntries(wanted.filter((c) => c in r).map((c) => [c, r[c]])));
      }
      return out;
    };
    builder.maybeSingle = async () => ({ data: result()[0] ?? null, error: null });
    builder.then = (resolve: (v: unknown) => void) => resolve({ data: result(), error: null });
    return builder;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    reads.push(`rpc:${name}:${args.p_user_id}`);
    return options.premiumError ? { data: null, error: { message: 'x' } } : { data: options.premium ?? false, error: null };
  };
  return { from, rpc, selects, reads };
}

const profileRow = (over: Row = {}): Row => ({
  id: USER,
  display_name: 'Eswar Private',
  food_preferences: ['halal'],
  language: 'ms',
  goal: 'recomp',
  training_level: 'beginner',
  equipment: 'gym',
  weight_kg: 70,
  height_cm: 175,
  age: 30,
  energy_sex: 'male',
  activity_level: 'light',
  ...over,
});
const planRow: Row = { id: 'plan-1', user_id: USER, start_date: START, status: 'active', cycle_number: 1 };
const dayRow = (n: number, over: Row = {}): Row => ({
  user_id: USER,
  plan_id: 'plan-1',
  day_number: n,
  workout: n % 2 ? { kind: 'workout', exercises: workoutEntries() } : { kind: 'rest' },
  calorie_target: 2650,
  protein_target_g: 125,
  ...over,
});
const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => dayRow(from + i));
const checkinRow = (date: string, over: Row = {}): Row => ({
  user_id: USER, checkin_date: date, weight_kg: 70, mood: 3, sleep_hours: 7, photo_path: `${USER}/${date}.jpg`, ...over,
});
const exerciseRows: Row[] = [
  ...catalogue.map((e) => ({ id: e.id, name: e.name, muscle_group: e.pattern, equipment: e.equipment, instructions: 'long text' })),
  { id: EX.homeSquat, name: 'Goblet squat', muscle_group: 'squat', equipment: 'home', instructions: 'x' },
];
const config = (value: unknown): Row[] => [{ key: 'free_plan_days', value }];
const world = (over: Record<string, Row[]> = {}) => ({
  profiles: [profileRow()],
  plans: [planRow],
  plan_days: days(1, 120),
  checkins: [],
  exercises: exerciseRows,
  app_config: config(14),
  ...over,
});

describe('loadCoachContext', () => {
  it('returns the language, goal and body inputs, and no identifier, name, preference or photo field', async () => {
    const context = await loadCoachContext(fakeDb(world({ checkins: [checkinRow('2026-10-17')] })), USER, NOW);

    expect(context.language).toBe('ms');
    expect(context.languageFellBack).toBe(false);
    expect(context.profile).toEqual({
      goal: 'recomp', trainingLevel: 'beginner', equipment: 'gym', weightKg: 70, heightCm: 175, age: 30, energySex: 'male', activityLevel: 'light',
    });
    expect(Object.keys(context).sort()).toEqual(['checkins', 'exercises', 'language', 'languageFellBack', 'planDays', 'profile', 'todayDayNumber']);
    expect(context.checkins).toEqual([{ date: '2026-10-17', weightKg: 70, mood: 3, sleepHours: 7 }]);
    const text = JSON.stringify(context);
    for (const forbidden of ['Eswar', 'halal', 'photo', USER, 'plan-1', 'instructions', 'long text']) expect(text).not.toContain(forbidden);
  });

  it('never selects identifying or photo columns', async () => {
    const db = fakeDb(world({ checkins: [checkinRow('2026-10-17')] }));

    await loadCoachContext(db, USER, NOW);

    const columns = db.selects.map((s) => s.columns).join(',');
    for (const forbidden of ['display_name', 'food_preferences', 'photo_path', 'email', '*', 'instructions']) expect(columns).not.toContain(forbidden);
    expect(db.selects.map((s) => s.table).sort()).toEqual(['app_config', 'checkins', 'exercises', 'plan_days', 'plans', 'profiles'].sort());
  });

  it('reads only the signed-in account, never another account\'s rows', async () => {
    const db = fakeDb(
      world({
        profiles: [profileRow(), profileRow({ id: OTHER, language: 'ta', weight_kg: 99 })],
        plans: [planRow, { id: 'plan-2', user_id: OTHER, start_date: '2020-01-01', status: 'active', cycle_number: 1 }],
        checkins: [checkinRow('2026-10-17'), checkinRow('2026-10-17', { user_id: OTHER, weight_kg: 123 })],
        plan_days: [...days(1, 120), ...days(1, 120).map((d) => ({ ...d, user_id: OTHER, plan_id: 'plan-2', calorie_target: 9999 }))],
      })
    );

    const context = await loadCoachContext(db, USER, NOW);

    expect(context.language).toBe('ms');
    expect(context.checkins.map((c) => c.weightKg)).toEqual([70]);
    expect(context.planDays.every((d) => d.calorieTarget === 2650)).toBe(true);
    expect(db.reads.filter((r) => r.startsWith('rpc')).every((r) => r.endsWith(USER))).toBe(true);
  });

  it('keeps at most ten check-ins, newest first', async () => {
    const many = Array.from({ length: 15 }, (_, i) => checkinRow(`2026-10-${String(i + 1).padStart(2, '0')}`));

    const context = await loadCoachContext(fakeDb(world({ checkins: many })), USER, NOW);

    expect(context.checkins).toHaveLength(COACH_LIMITS.maxCheckins);
    expect(context.checkins[0].date).toBe('2026-10-15');
    expect(context.checkins[9].date).toBe('2026-10-06');
  });

  it('offers only future days the member can open: from plan day today+2 to the horizon, within the free days', async () => {
    const context = await loadCoachContext(fakeDb(world()), USER, NOW);

    expect(context.todayDayNumber).toBe(3);
    expect(context.planDays.map((d) => d.dayNumber)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]); // today+2 .. 14 free days
    expect(context.planDays[0].date).toBe('2026-10-20');
  });

  it('opens up to the horizon for a premium member', async () => {
    const context = await loadCoachContext(fakeDb(world(), { premium: true }), USER, NOW);

    expect(context.planDays.map((d) => d.dayNumber)).toEqual(Array.from({ length: COACH_LIMITS.horizonDays - 1 }, (_, i) => 5 + i));
    expect(context.planDays.at(-1)!.dayNumber).toBe(3 + COACH_LIMITS.horizonDays);
  });

  it('follows the server-configured free plan days, and offers nothing if the config is invalid or premium cannot be read', async () => {
    expect((await loadCoachContext(fakeDb(world({ app_config: config(9) })), USER, NOW)).planDays.map((d) => d.dayNumber)).toEqual([5, 6, 7, 8, 9]);
    expect((await loadCoachContext(fakeDb(world({ app_config: config('lots') })), USER, NOW)).planDays).toEqual([]);
    expect((await loadCoachContext(fakeDb(world({ app_config: [] })), USER, NOW)).planDays).toEqual([]);
    expect((await loadCoachContext(fakeDb(world({ app_config: config(9) }), { premiumError: true }), USER, NOW)).planDays.length).toBe(5);
  });

  it('only exposes the member\'s own equipment group of exercises, as id, name and pattern', async () => {
    const context = await loadCoachContext(fakeDb(world()), USER, NOW);

    expect(context.exercises.map((e) => e.id)).not.toContain(EX.homeSquat);
    expect(context.exercises).toHaveLength(catalogue.length);
    expect(context.exercises[0]).toEqual({ id: expect.any(String), name: expect.any(String), pattern: expect.any(String), equipment: 'gym' });
  });

  it('falls back to English, observably, for a missing or unsupported language', async () => {
    const context = await loadCoachContext(fakeDb(world({ profiles: [profileRow({ language: 'fr' })] })), USER, NOW);

    expect(context.language).toBe('en');
    expect(context.languageFellBack).toBe(true);
  });

  it('copes with a missing profile', async () => {
    const context = await loadCoachContext(fakeDb(world({ profiles: [] })), USER, NOW);

    expect(context.profile).toBeNull();
    expect(context.planDays).toEqual([]);
    expect(context.exercises).toEqual([]);
    expect(context.language).toBe('en');
  });

  it('treats an incomplete profile as missing', async () => {
    const context = await loadCoachContext(fakeDb(world({ profiles: [profileRow({ weight_kg: null })] })), USER, NOW);

    expect(context.profile).toBeNull();
    expect(context.planDays).toEqual([]);
  });

  it('copes with a missing plan', async () => {
    const context = await loadCoachContext(fakeDb(world({ plans: [] })), USER, NOW);

    expect(context.todayDayNumber).toBeNull();
    expect(context.planDays).toEqual([]);
    expect(context.profile).not.toBeNull();
  });

  it('offers nothing once the plan has finished or before it starts opening days', async () => {
    // A finished earlier cycle never shadows the active one (roadmap B3).
    const twoCycles = await loadCoachContext(
      fakeDb(world({ plans: [{ ...planRow, id: 'plan-0', start_date: '2025-01-01', status: 'completed', cycle_number: 1 }, { ...planRow, id: 'plan-3', cycle_number: 2 }] })),
      USER,
      NOW
    );
    expect(twoCycles.todayDayNumber).toBe(3);

    const finished = await loadCoachContext(fakeDb(world({ plans: [{ ...planRow, start_date: '2026-01-01' }] })), USER, NOW);
    expect(finished.planDays).toEqual([]);

    const notStarted = await loadCoachContext(fakeDb(world({ plans: [{ ...planRow, start_date: '2026-11-30' }] })), USER, NOW);
    expect(notStarted.todayDayNumber).toBeLessThan(1);
    expect(notStarted.planDays.every((d) => d.dayNumber >= 1)).toBe(true);
  });

  it('reads the workout shape and targets of each editable day as stored', async () => {
    const context = await loadCoachContext(fakeDb(world({ plan_days: [dayRow(5), dayRow(6, { calorie_target: null })] })), USER, NOW);

    expect(context.planDays).toEqual([
      { dayNumber: 5, date: '2026-10-20', workout: { kind: 'workout', exercises: workoutEntries() }, calorieTarget: 2650, proteinTargetG: 125 },
      { dayNumber: 6, date: '2026-10-21', workout: { kind: 'rest' }, calorieTarget: null, proteinTargetG: 125 },
    ]);
  });
});
