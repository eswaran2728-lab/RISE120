// Deterministic checks on everything the model returns. Prompts alone are not a safety control: a proposal is
// stored only if it passes every rule here, against the member's real plan, equipment and the existing server
// nutrition rules. A proposal is all-or-nothing: if any patch fails, none is kept (the reply text may stay).
import { NUTRITION_RULES, rawCalorieEstimate } from '../plan/generate.ts';
import type { PlanWorkout, WorkoutEntry } from '../plan/types.ts';
import {
  COACH_BOUNDS,
  COACH_LIMITS,
  CoachContext,
  CoachPlanDay,
  CoachProposalNext,
  CoachProposalPatch,
  CoachReply,
  CoachValidationError,
} from './types.ts';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const hasOnly = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));

export function validateMessage(value: unknown): string {
  if (typeof value !== 'string') throw new CoachValidationError('invalid_message');
  const message = value.trim();
  if (message.length === 0 || message.length > COACH_LIMITS.maxMessageChars) throw new CoachValidationError('invalid_message');
  return message;
}

function checkText(value: unknown): string {
  if (typeof value !== 'string') throw new CoachValidationError('invalid_reply');
  const text = value.trim();
  if (text.length === 0 || text.length > COACH_LIMITS.maxReplyChars) throw new CoachValidationError('invalid_reply');
  return text;
}

type Structure = { patches: CoachProposalPatch[] } | { dropped: string };

// Reads the model's proposal into typed patches. Only an allowlist of fields is accepted: anything else (an SQL
// string, a JSON path, an unknown key) drops the whole proposal rather than being passed on.
function parseProposal(value: unknown): Structure | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !hasOnly(value, ['patches'])) return { dropped: 'unknown_field' };
  const list = value.patches;
  if (!Array.isArray(list)) return { dropped: 'malformed_proposal' };
  if (list.length === 0) return null;
  if (list.length > COACH_LIMITS.maxPatches) return { dropped: 'too_many_patches' };

  const patches: CoachProposalPatch[] = [];
  for (const item of list) {
    if (!isRecord(item)) return { dropped: 'malformed_proposal' };
    if (!hasOnly(item, ['dayNumber', 'workout', 'calorieTarget', 'proteinTargetG'])) return { dropped: 'unknown_field' };
    if (typeof item.dayNumber !== 'number') return { dropped: 'malformed_proposal' };

    const next: CoachProposalNext = {};
    if (item.workout !== undefined) {
      const workout = item.workout;
      if (!isRecord(workout) || !hasOnly(workout, ['kind', 'exercises'])) return { dropped: 'unknown_field' };
      if (workout.kind === 'rest') {
        next.workout = { kind: 'rest' };
      } else {
        if (workout.kind !== 'workout' || !Array.isArray(workout.exercises)) return { dropped: 'malformed_proposal' };
        const entries: WorkoutEntry[] = [];
        for (const entry of workout.exercises) {
          if (!isRecord(entry) || !hasOnly(entry, ['exercise_id', 'sets', 'reps'])) return { dropped: 'unknown_field' };
          entries.push({ exercise_id: entry.exercise_id as string, sets: entry.sets as number, reps: entry.reps as number });
        }
        next.workout = { kind: 'workout', exercises: entries };
      }
    }
    if (item.calorieTarget !== undefined) next.calorieTarget = item.calorieTarget as number;
    if (item.proteinTargetG !== undefined) next.proteinTargetG = item.proteinTargetG as number;
    patches.push({ dayNumber: item.dayNumber, next });
  }
  return { patches };
}

// Parses the provider's JSON text. A bad reply (not JSON, no text, too long) throws: nothing usable exists.
// A bad proposal only removes the proposal.
export function parseCoachOutput(text: string): CoachReply {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CoachValidationError('malformed_json');
  }
  if (!isRecord(raw)) throw new CoachValidationError('malformed_json');
  const reply = checkText(raw.reply);

  const parsed = parseProposal(raw.proposal);
  if (parsed === null) return { text: reply, proposal: null };
  if ('dropped' in parsed) return { text: reply, proposal: null, droppedProposal: [parsed.dropped] };
  return { text: reply, proposal: { patches: parsed.patches } };
}

// 1.6 to 2.0 g per kg: the range the existing plan rules use for the three goals.
function proteinBounds(weightKg: number): { min: number; max: number } {
  const perKg = Object.values(NUTRITION_RULES.proteinPerKg);
  const exact = (value: number) => Number(value.toFixed(6)); // 1.6 * 70 is 112.00000000000001, not 113
  return { min: Math.ceil(exact(Math.min(...perKg) * weightKg)), max: Math.floor(exact(Math.max(...perKg) * weightKg)) };
}

function checkWorkout(next: PlanWorkout, day: CoachPlanDay, context: CoachContext, reasons: Set<string>): void {
  if (day.workout.kind === 'rest') {
    reasons.add('workout_on_rest_day');
    return;
  }
  const current = day.workout.exercises;
  if (next.kind !== 'workout' || !Array.isArray(next.exercises) || next.exercises.length !== current.length) {
    reasons.add('workout_shape');
    return;
  }
  const catalogue = new Map(context.exercises.map((exercise) => [exercise.id, exercise]));
  const seen = new Set<string>();

  next.exercises.forEach((entry, index) => {
    const before = current[index];
    const exercise = typeof entry.exercise_id === 'string' ? catalogue.get(entry.exercise_id) : undefined;
    if (!exercise) {
      reasons.add('unknown_exercise');
    } else {
      if (exercise.equipment !== context.profile?.equipment) reasons.add('wrong_equipment');
      if (exercise.pattern !== catalogue.get(before.exercise_id)?.pattern) reasons.add('pattern_mismatch');
      if (seen.has(exercise.id)) reasons.add('duplicate_exercise');
      seen.add(exercise.id);
    }

    if (!isInt(entry.sets) || !isInt(entry.reps)) {
      reasons.add('invalid_number');
      return;
    }
    const setsOk = entry.sets >= COACH_BOUNDS.setsMin && entry.sets <= COACH_BOUNDS.setsMax && Math.abs(entry.sets - before.sets) <= COACH_BOUNDS.maxSetsDelta;
    const repsOk = entry.reps >= COACH_BOUNDS.repsMin && entry.reps <= COACH_BOUNDS.repsMax && Math.abs(entry.reps - before.reps) <= COACH_BOUNDS.maxRepsDelta;
    if (!setsOk) reasons.add('sets_out_of_range');
    if (!repsOk) reasons.add('reps_out_of_range');
  });
}

function checkCalories(value: unknown, day: CoachPlanDay, context: CoachContext, reasons: Set<string>): void {
  if (!isInt(value)) {
    reasons.add('invalid_number');
    return;
  }
  if (day.calorieTarget === null) reasons.add('calories_without_base');
  const raw = context.profile ? rawCalorieEstimate(context.profile, NUTRITION_RULES) : null;
  if (raw === null || raw < NUTRITION_RULES.minCalories) reasons.add('raw_estimate_below_minimum');
  if (value < NUTRITION_RULES.minCalories) reasons.add('calories_below_minimum');
  if (value % NUTRITION_RULES.calorieRounding !== 0) reasons.add('calories_not_rounded');
  if (day.calorieTarget !== null && Math.abs(value - day.calorieTarget) > COACH_BOUNDS.maxCalorieDelta) reasons.add('calories_change_too_large');
}

function checkProtein(value: unknown, context: CoachContext, reasons: Set<string>): void {
  if (!isInt(value)) {
    reasons.add('invalid_number');
    return;
  }
  const bounds = proteinBounds(context.profile!.weightKg);
  if (value < bounds.min || value > bounds.max) reasons.add('protein_out_of_range');
}

function checkProposal(patches: CoachProposalPatch[], context: CoachContext): { patches: CoachProposalPatch[] } | { reasons: string[] } {
  if (!context.profile) return { reasons: ['no_profile'] };
  if (patches.length === 0) return { reasons: ['empty_patch'] };
  if (patches.length > COACH_LIMITS.maxPatches) return { reasons: ['too_many_patches'] };

  const reasons = new Set<string>();
  const days = new Set<number>();
  const result: CoachProposalPatch[] = [];

  for (const patch of patches) {
    const day = Number.isInteger(patch.dayNumber) ? context.planDays.find((d) => d.dayNumber === patch.dayNumber) : undefined;
    const earliest = context.todayDayNumber === null ? 1 : context.todayDayNumber + COACH_BOUNDS.earliestOffsetDays;
    if (!day || patch.dayNumber < earliest) {
      reasons.add('day_not_editable');
      continue;
    }
    if (days.has(patch.dayNumber)) reasons.add('duplicate_day');
    days.add(patch.dayNumber);

    const next = patch.next ?? {};
    const hasWorkout = next.workout !== undefined;
    const hasCalories = next.calorieTarget !== undefined;
    const hasProtein = next.proteinTargetG !== undefined;
    if (!hasWorkout && !hasCalories && !hasProtein) {
      reasons.add('empty_patch');
      continue;
    }

    const before = reasons.size;
    if (hasWorkout) checkWorkout(next.workout!, day, context, reasons);
    if (hasCalories) checkCalories(next.calorieTarget, day, context, reasons);
    if (hasProtein) checkProtein(next.proteinTargetG, context, reasons);

    const unchanged =
      (!hasWorkout || JSON.stringify(next.workout) === JSON.stringify(day.workout)) &&
      (!hasCalories || next.calorieTarget === day.calorieTarget) &&
      (!hasProtein || next.proteinTargetG === day.proteinTargetG);
    if (unchanged && reasons.size === before) reasons.add('no_change');

    // Keep only the allowed fields, and take the prior values from the real plan, never from the model.
    const clean: CoachProposalNext = {};
    if (hasWorkout) clean.workout = next.workout;
    if (hasCalories) clean.calorieTarget = next.calorieTarget;
    if (hasProtein) clean.proteinTargetG = next.proteinTargetG;
    result.push({ dayNumber: patch.dayNumber, next: clean, expected: { workout: day.workout, calorieTarget: day.calorieTarget, proteinTargetG: day.proteinTargetG } });
  }

  return reasons.size > 0 ? { reasons: [...reasons] } : { patches: result };
}

export function validateCoachReply(reply: CoachReply, context: CoachContext): CoachReply {
  const text = checkText(reply.text);
  if (!reply.proposal) return { ...reply, text, proposal: null };

  const checked = checkProposal(reply.proposal.patches ?? [], context);
  if ('patches' in checked) return { ...reply, text, proposal: { patches: checked.patches } };
  return { ...reply, text, proposal: null, droppedProposal: [...(reply.droppedProposal ?? []), ...checked.reasons] };
}
