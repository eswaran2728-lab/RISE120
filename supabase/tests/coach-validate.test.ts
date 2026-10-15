import { COACH_BOUNDS, COACH_LIMITS, CoachContext, CoachReply, CoachProposalPatch } from '../functions/_shared/coach/types';
import { parseCoachOutput, validateCoachReply, validateMessage } from '../functions/_shared/coach/validate';
import { NUTRITION_RULES } from '../functions/_shared/plan/generate';
import { baseContext, EX, workoutEntries } from './coach-fixtures';

const reply = (patches: CoachProposalPatch[] | null, text = 'Here is a small adjustment.'): CoachReply => ({
  text,
  proposal: patches ? { patches } : null,
});
const patch = (dayNumber: number, next: CoachProposalPatch['next']): CoachProposalPatch => ({ dayNumber, next });
const workoutWith = (change: (entries: ReturnType<typeof workoutEntries>) => void) => {
  const entries = workoutEntries();
  change(entries);
  return { kind: 'workout' as const, exercises: entries };
};
const rejected = (r: CoachReply, context: CoachContext = baseContext()) => validateCoachReply(r, context).droppedProposal ?? [];

describe('pinned coach limits (a test, not just prose)', () => {
  it('fixes the message, output, context and proposal budgets', () => {
    expect(COACH_LIMITS).toEqual({ maxMessageChars: 1000, maxReplyChars: 1500, maxOutputTokens: 700, maxCheckins: 10, maxPatches: 7, horizonDays: 14, providerTimeoutMs: 20000 });
    expect(COACH_BOUNDS).toEqual({ earliestOffsetDays: 2, maxCalorieDelta: 250, setsMin: 1, setsMax: 6, maxSetsDelta: 1, repsMin: 4, repsMax: 20, maxRepsDelta: 2 });
  });

  it('keeps the protein range and calorie cutoff the existing server plan rules define', () => {
    expect(Math.min(...Object.values(NUTRITION_RULES.proteinPerKg))).toBe(1.6);
    expect(Math.max(...Object.values(NUTRITION_RULES.proteinPerKg))).toBe(2.0);
    expect(NUTRITION_RULES.minCalories).toBe(1500);
  });
});

describe('validateMessage', () => {
  it('trims and accepts a normal message up to the maximum length', () => {
    expect(validateMessage('  How is my week?  ')).toBe('How is my week?');
    expect(validateMessage('x'.repeat(COACH_LIMITS.maxMessageChars))).toHaveLength(COACH_LIMITS.maxMessageChars);
  });

  it.each([['empty', ''], ['blank', '   \n '], ['one too long', 'x'.repeat(COACH_LIMITS.maxMessageChars + 1)], ['not text', 42 as unknown as string]])('rejects a message that is %s', (_name, value) => {
    expect(() => validateMessage(value)).toThrow();
  });
});

describe('parseCoachOutput', () => {
  const json = (value: unknown) => JSON.stringify(value);

  it('reads a reply with no proposal', () => {
    expect(parseCoachOutput(json({ reply: 'Keep going.', proposal: null }))).toEqual({ text: 'Keep going.', proposal: null });
    expect(parseCoachOutput(json({ reply: 'Keep going.' }))).toEqual({ text: 'Keep going.', proposal: null });
  });

  it('reads a proposal into typed patches without trusting any prior values', () => {
    const parsed = parseCoachOutput(json({ reply: 'ok', proposal: { patches: [{ dayNumber: 5, calorieTarget: 2600, proteinTargetG: 120 }] } }));

    expect(parsed.proposal).toEqual({ patches: [{ dayNumber: 5, next: { calorieTarget: 2600, proteinTargetG: 120 } }] });
  });

  it.each([['malformed JSON', '{not json'], ['not an object', '"hi"'], ['no reply', '{"proposal":null}'], ['reply not text', '{"reply":5}'], ['empty reply', '{"reply":"  "}'], ['array', '[]']])(
    'throws for %s',
    (_name, text) => {
      expect(() => parseCoachOutput(text)).toThrow();
    }
  );

  it('throws for an overlong reply', () => {
    expect(() => parseCoachOutput(json({ reply: 'x'.repeat(COACH_LIMITS.maxReplyChars + 1) }))).toThrow();
    expect(parseCoachOutput(json({ reply: 'x'.repeat(COACH_LIMITS.maxReplyChars) })).text).toHaveLength(COACH_LIMITS.maxReplyChars);
  });

  it.each([
    ['an unknown field on a patch', { patches: [{ dayNumber: 5, calorieTarget: 2600, sql: 'update plan_days' }] }],
    ['a JSON path field', { patches: [{ dayNumber: 5, path: 'workout.exercises[0]', value: 1 }] }],
    ['an unknown field on the proposal', { patches: [{ dayNumber: 5, calorieTarget: 2600 }], extra: true }],
    ['patches that are not a list', { patches: 'all' }],
    ['a patch that is not an object', { patches: [5] }],
    ['a non-numeric day', { patches: [{ dayNumber: '5', calorieTarget: 2600 }] }],
    ['too many patches', { patches: Array.from({ length: COACH_LIMITS.maxPatches + 1 }, (_, i) => ({ dayNumber: 5 + i, calorieTarget: 2600 })) }],
    ['an unknown field on a workout entry', { patches: [{ dayNumber: 5, workout: { kind: 'workout', exercises: [{ exercise_id: EX.squat1, sets: 2, reps: 10, note: 'x' }] } }] }],
  ])('keeps the reply but drops a proposal with %s', (_name, proposal) => {
    const parsed = parseCoachOutput(json({ reply: 'ok', proposal }));

    expect(parsed.text).toBe('ok');
    expect(parsed.proposal).toBeNull();
    expect(parsed.droppedProposal?.length).toBeGreaterThan(0);
  });
});

describe('validateCoachReply: replies without proposals', () => {
  it('passes a plain reply through and marks nothing dropped', () => {
    expect(validateCoachReply(reply(null, 'Rest well.'), baseContext())).toEqual({ text: 'Rest well.', proposal: null });
  });

  it('rejects an empty or overlong reply text', () => {
    expect(() => validateCoachReply(reply(null, ''), baseContext())).toThrow();
    expect(() => validateCoachReply(reply(null, 'x'.repeat(COACH_LIMITS.maxReplyChars + 1)), baseContext())).toThrow();
  });
});

describe('validateCoachReply: a valid bounded proposal', () => {
  it('accepts a same-pattern exercise swap with small set and rep changes, and fills the prior values from the plan', () => {
    const next = { workout: workoutWith((e) => { e[0] = { exercise_id: EX.squat2, sets: 3, reps: 11 }; }) };

    const result = validateCoachReply(reply([patch(5, next)]), baseContext());

    expect(result.droppedProposal).toBeUndefined();
    expect(result.proposal?.patches[0]).toEqual({
      dayNumber: 5,
      next,
      expected: { workout: { kind: 'workout', exercises: workoutEntries() }, calorieTarget: 2650, proteinTargetG: 125 },
    });
  });

  it('accepts a nutrition change on a workout day and on a rest day', () => {
    const result = validateCoachReply(reply([patch(5, { calorieTarget: 2750, proteinTargetG: 130 }), patch(6, { calorieTarget: 2550 })]), baseContext());

    expect(result.droppedProposal).toBeUndefined();
    expect(result.proposal?.patches.map((p) => p.dayNumber)).toEqual([5, 6]);
  });

  it('ignores prior values the model supplies and uses the real ones', () => {
    const forged = { dayNumber: 5, next: { calorieTarget: 2700 }, expected: { workout: { kind: 'rest' as const }, calorieTarget: 9999, proteinTargetG: 1 } };

    const result = validateCoachReply(reply([forged]), baseContext());

    expect(result.proposal?.patches[0].expected).toEqual({ workout: { kind: 'workout', exercises: workoutEntries() }, calorieTarget: 2650, proteinTargetG: 125 });
  });
});

describe('validateCoachReply: eligible days', () => {
  it.each([[1, 'past day'], [3, 'today'], [4, 'tomorrow (could be today in another time zone)'], [8, 'a day outside the editable window'], [121, 'beyond the plan'], [0, 'day zero'], [5.5, 'a fractional day']])(
    'drops a proposal for day %s (%s)',
    (day) => {
      expect(rejected(reply([patch(day, { calorieTarget: 2700 })]))).toContain('day_not_editable');
    }
  );

  it('drops duplicate days and more patches than allowed', () => {
    expect(rejected(reply([patch(5, { calorieTarget: 2700 }), patch(5, { calorieTarget: 2600 })]))).toContain('duplicate_day');
    const many = Array.from({ length: COACH_LIMITS.maxPatches + 1 }, () => patch(5, { calorieTarget: 2700 }));
    expect(rejected(reply(many))).toContain('too_many_patches');
  });

  it('drops everything when any one patch is bad, and keeps the reply text', () => {
    const result = validateCoachReply(reply([patch(5, { calorieTarget: 2700 }), patch(7, { calorieTarget: 1000 })], 'Some advice'), baseContext());

    expect(result.proposal).toBeNull();
    expect(result.text).toBe('Some advice');
    expect(result.droppedProposal).toContain('calories_below_minimum');
  });

  it('allows no proposal at all without a profile or without editable days', () => {
    expect(rejected(reply([patch(5, { calorieTarget: 2700 })]), baseContext({ profile: null }))).toContain('no_profile');
    expect(rejected(reply([patch(5, { calorieTarget: 2700 })]), baseContext({ planDays: [] }))).toContain('day_not_editable');
  });

  it('drops an empty patch and one that changes nothing', () => {
    expect(rejected(reply([patch(5, {})]))).toContain('empty_patch');
    expect(rejected(reply([patch(5, { calorieTarget: 2650 })]))).toContain('no_change');
    expect(rejected(reply([patch(5, { workout: { kind: 'workout', exercises: workoutEntries() } })]))).toContain('no_change');
  });
});

describe('validateCoachReply: workout structure', () => {
  const bad = (change: (e: ReturnType<typeof workoutEntries>) => void, day = 5) => rejected(reply([patch(day, { workout: workoutWith(change) })]));

  it('never changes a rest day into a workout day, or a workout day into a rest day', () => {
    expect(rejected(reply([patch(6, { workout: { kind: 'workout', exercises: workoutEntries() } })]))).toContain('workout_on_rest_day');
    expect(rejected(reply([patch(5, { workout: { kind: 'rest' } })]))).toContain('workout_shape');
  });

  it('rejects an exercise that does not exist, with the exact reason', () => {
    expect(bad((e) => { e[0] = { exercise_id: EX.ghost, sets: 2, reps: 10 }; })).toContain('unknown_exercise');
    expect(bad((e) => { e[0] = { exercise_id: 'squat; drop table', sets: 2, reps: 10 }; })).toContain('unknown_exercise');
  });

  it('rejects an exercise from another equipment group', () => {
    const withForeign = baseContext({ exercises: [...baseContext().exercises, { id: EX.homeSquat, name: 'Goblet squat', pattern: 'squat', equipment: 'home' }] });

    const dropped = rejected(reply([patch(5, { workout: workoutWith((e) => { e[0] = { exercise_id: EX.homeSquat, sets: 2, reps: 10 }; }) })]), withForeign);

    expect(dropped).toContain('wrong_equipment');
  });

  it('keeps the movement pattern in each position', () => {
    expect(bad((e) => { e[0] = { exercise_id: EX.push1, sets: 2, reps: 10 }; })).toContain('pattern_mismatch');
  });

  it('keeps the number of exercises and forbids repeats', () => {
    expect(bad((e) => { e.pop(); })).toContain('workout_shape');
    expect(bad((e) => { e.push({ exercise_id: EX.core2, sets: 2, reps: 10 }); })).toContain('workout_shape');
    expect(bad((e) => { e[4] = { exercise_id: EX.squat1, sets: 2, reps: 10 }; e[0] = { exercise_id: EX.squat1, sets: 2, reps: 10 }; })).toEqual(expect.arrayContaining(['pattern_mismatch']));
  });

  it('bounds sets and reps, and how far they move in one proposal', () => {
    expect(bad((e) => { e[0].sets = 4; })).toContain('sets_out_of_range'); // more than +1
    expect(bad((e) => { e[0].sets = 0; })).toContain('sets_out_of_range');
    expect(bad((e) => { e[0].reps = 13; })).toContain('reps_out_of_range'); // more than +2
    expect(bad((e) => { e[0].reps = 3; })).toContain('reps_out_of_range');
    expect(bad((e) => { e[0].sets = 2.5; })).toContain('invalid_number');
    expect(bad((e) => { e[0].reps = Number.NaN; })).toContain('invalid_number');
  });
});

describe('validateCoachReply: nutrition rules', () => {
  const cal = (n: unknown, context?: CoachContext) => rejected(reply([patch(5, { calorieTarget: n as number })]), context);
  const protein = (n: unknown) => rejected(reply([patch(5, { proteinTargetG: n as number })]));
  const noBase = baseContext({ planDays: baseContext().planDays.map((d) => ({ ...d, calorieTarget: null })) });

  it('never proposes a calorie target when the plan has none', () => {
    expect(cal(2000, noBase)).toContain('calories_without_base');
    expect(rejected(reply([patch(5, { proteinTargetG: 130 })]), noBase)).toEqual([]); // protein is still fine
  });

  it('refuses a calorie target below the 1,500 kcal cutoff', () => {
    const low = baseContext({ planDays: baseContext().planDays.map((d) => ({ ...d, calorieTarget: 1550 })) });

    expect(cal(1450, low)).toContain('calories_below_minimum');
    expect(cal(1500, low)).toEqual([]);
  });

  it('applies the cutoff to the raw estimate, not the rounded target', () => {
    // 52 kg, 160 cm, 40 y, female, sedentary, lose fat: raw estimate 1,322.6 kcal is below 1,500 even though the stored target is 1,550.
    const small = baseContext({
      profile: { goal: 'lose_fat', trainingLevel: 'beginner', equipment: 'gym', weightKg: 52, heightCm: 160, age: 40, energySex: 'female', activityLevel: 'sedentary' },
      planDays: baseContext().planDays.map((d) => ({ ...d, calorieTarget: 1550 })),
    });

    expect(cal(1550 - 50, small)).toContain('raw_estimate_below_minimum');
  });

  it('needs the energy inputs on the profile to propose calories', () => {
    const undisclosed = baseContext({ profile: { ...baseContext().profile!, energySex: 'undisclosed' } });

    expect(cal(2700, undisclosed)).toContain('raw_estimate_below_minimum');
  });

  it('keeps calorie targets on the plan rounding and within a small change', () => {
    expect(cal(2675)).toContain('calories_not_rounded');
    expect(cal(2650 + COACH_BOUNDS.maxCalorieDelta)).toEqual([]);
    expect(cal(2650 + COACH_BOUNDS.maxCalorieDelta + 50)).toContain('calories_change_too_large');
    expect(cal(2650 - COACH_BOUNDS.maxCalorieDelta - 50)).toContain('calories_change_too_large');
  });

  it.each([[Number.NaN], [Infinity], ['2700'], [2700.5], [-2700], [null]])('rejects a non-integer calorie value %s', (value) => {
    expect(cal(value).length).toBeGreaterThan(0);
  });

  it('keeps protein within 1.6 to 2.0 g per kg of body weight (70 kg: 112 to 140 g)', () => {
    expect(protein(112)).toEqual([]);
    expect(protein(140)).toEqual([]);
    expect(protein(111)).toContain('protein_out_of_range');
    expect(protein(141)).toContain('protein_out_of_range');
    expect(protein(0)).toContain('protein_out_of_range');
  });

  it('rounds the protein bounds inward for a body weight that is not a round number', () => {
    const heavier = baseContext({ profile: { ...baseContext().profile!, weightKg: 73.3 } }); // 117.28 to 146.6

    expect(rejected(reply([patch(5, { proteinTargetG: 117 })]), heavier)).toContain('protein_out_of_range');
    expect(rejected(reply([patch(5, { proteinTargetG: 118 })]), heavier)).toEqual([]);
    expect(rejected(reply([patch(5, { proteinTargetG: 146 })]), heavier)).toEqual([]);
    expect(rejected(reply([patch(5, { proteinTargetG: 147 })]), heavier)).toContain('protein_out_of_range');
  });

  it.each([[112.5], ['120'], [Number.NaN]])('rejects a non-integer protein value %s', (value) => {
    expect(protein(value).length).toBeGreaterThan(0);
  });
});
