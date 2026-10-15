// Evaluation scenarios: deidentified check-ins used to compare coach providers. The loader is a gate, not a
// convenience. Every field is checked twice: its NAME against an allowlist, and its VALUE against a strict runtime
// schema (enums, integer and numeric ranges, calendar dates, UUIDs, short plain names). What reaches a provider
// prompt is rebuilt from the validated values, never copied from the file. Free text (the message and the
// expectation phrases) is scanned for contact details and for identifying phrases. A bad scenario rejects the
// WHOLE file. Errors name the scenario id, a code and a field path, never the rejected value.
//
// Limits to be honest about: no scan can prove free text holds no personal information (a bare first name passes),
// and `consent: true` is only a declaration typed into a file. A person must deidentify each real check-in by hand
// and independently verify consent before the file is used; live mode asks for that attestation explicitly.
import type { CoachContext, CoachLanguage } from '../../supabase/functions/_shared/coach/types.ts';
import { COACH_LANGUAGES, COACH_LIMITS } from '../../supabase/functions/_shared/coach/types.ts';

export type ProposalExpectation = 'required' | 'none' | 'optional';

export interface ScenarioExpectation {
  referral: boolean; // the member needs a health professional, not training advice
  proposal: ProposalExpectation;
  mustMention: string[]; // facts from the check-in the reply must repeat
  mustNotMention: string[]; // numbers or claims that would be invented
  forbidden: string[]; // phrases that make a reply unsafe
}

// Deliberately has no consent field: consent is checked when the file is read and cannot be inferred later.
export interface EvalScenario {
  id: string;
  language: CoachLanguage;
  message: string;
  context: Omit<CoachContext, 'language' | 'languageFellBack'>;
  expectation: ScenarioExpectation;
}

export type ProblemCode =
  | 'no_consent'
  | 'not_deidentified'
  | 'identifying_field'
  | 'photo'
  | 'unknown_field'
  | 'contact_detail'
  | 'identifying_text'
  | 'bad_value'
  | 'bad_language'
  | 'duplicate_id'
  | 'empty'
  | 'bad_shape';

export interface ScenarioProblem {
  scenarioId: string;
  code: ProblemCode;
  path: string;
}

export class ScenarioRejected extends Error {
  readonly problems: ScenarioProblem[];

  constructor(problems: ScenarioProblem[]) {
    super(`scenarios_rejected: ${problems.length} problem(s): ${[...new Set(problems.map((p) => p.code))].join(', ')}`);
    this.name = 'ScenarioRejected';
    this.problems = problems;
    Object.setPrototypeOf(this, ScenarioRejected.prototype);
  }
}

// Value limits mirror the database checks (profiles, checkins) and the coach's own bounds.
const GOALS = ['lose_fat', 'build_muscle', 'recomp'];
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const EQUIPMENT = ['gym', 'home', 'none'];
const SEXES = ['male', 'female', 'undisclosed'];
const ACTIVITY = ['sedentary', 'light', 'active'];
const PATTERNS = ['squat', 'hinge', 'push', 'pull', 'core'];
const MAX_EXERCISES = 300;
const MAX_PHRASES = 20;
const MAX_PHRASE_CHARS = 60;
const MAX_NAME_CHARS = 60;

const PHOTO_KEY = /(photo|image|img|picture|selfie|avatar|video)/i;
const IDENTIFYING_KEY = /^(user_?id|account_?id|plan_?id|e_?mail|full_?name|first_?name|last_?name|name|phone|mobile|tel|address|dob|birth|ic|nric|passport|ip|location|gps)/i;
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAIN_NAME = /^[\p{L}\p{N}][\p{L}\p{N} '()\-/.,&]*$/u;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LINK = /(https?:\/\/|www\.)/i;
const DATA_URI = /data:[a-z]+\/[a-z0-9.+-]+;base64/i;
const IMAGE_FILE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)\b/i;
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function hasPhoneNumber(text: string): boolean {
  for (const match of text.matchAll(/\+?\d[\d\s().-]{6,}\d/g)) {
    if (match[0].replace(/\D/g, '').length >= 9) return true;
  }
  return false;
}

function hasContactDetail(text: string): boolean {
  return EMAIL.test(text) || LINK.test(text) || DATA_URI.test(text) || IMAGE_FILE.test(text) || UUID_IN_TEXT.test(text) || hasPhoneNumber(text);
}

// Phrases that introduce a person or a place, ID numbers and street addresses, in English, Malay and Tamil.
const IDENTIFYING_PATTERNS: RegExp[] = [
  /\b(my name is|i am called|i'm called|call me|my address|i live (at|in|on)|my ic|my passport)\b/i,
  /\b(nama saya|saya bernama|panggil saya|alamat saya|saya tinggal di|ic saya|pasport saya)\b/i,
  /(என் பெயர்|என் முகவரி|நான் வசிக்கிறேன்|என்னை .{1,20} என்று அழை)/,
  /\b\d{6}[-\s]?\d{2}[-\s]?\d{4}\b/, // Malaysian IC / NRIC
  /\b[A-Z]{1,2}\d{7,8}\b/, // passport-like
  /\b\d{1,4}[a-z]?,?\s+(jalan|jln|lorong|lrg|persiaran|taman|street|st\.?|road|rd\.?|avenue|ave\.?|lane|drive|dr\.?)\b/i,
  /\b(block|blok|unit|no\.)\s*\d+/i,
  /(^|\s)@\w{3,}/,
  /\d{9,}/, // a long unbroken digit run (account, card, phone without separators)
];

const looksIdentifying = (text: string) => IDENTIFYING_PATTERNS.some((pattern) => pattern.test(text));

class Collector {
  readonly problems: ScenarioProblem[] = [];
  readonly scenarioId: string;
  constructor(scenarioId: string) {
    this.scenarioId = scenarioId;
  }
  add(code: ProblemCode, path: string) {
    this.problems.push({ scenarioId: this.scenarioId, code, path });
  }
}

// Every key must be on the allowlist; the first unknown key is classified so the error says why it matters.
function strictKeys(c: Collector, value: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    c.add(PHOTO_KEY.test(key) ? 'photo' : IDENTIFYING_KEY.test(key) ? 'identifying_field' : 'unknown_field', path);
  }
}

function recordAt(c: Collector, value: unknown, path: string): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  c.add('bad_shape', path);
  return null;
}

function listAt(c: Collector, value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) {
    c.add('bad_shape', path);
    return [];
  }
  if (value.length > max) {
    c.add('bad_value', path);
    return [];
  }
  return value;
}

const text = (c: Collector, value: unknown, path: string, max: number): string | null => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || CONTROL.test(value)) {
    c.add('bad_value', path);
    return null;
  }
  return value;
};

function oneOf<T extends string>(c: Collector, value: unknown, allowed: readonly T[], path: string): T | null {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  c.add('bad_value', path);
  return null;
}

function num(c: Collector, value: unknown, min: number, max: number, path: string, integer = false): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    c.add('bad_value', path);
    return null;
  }
  return value;
}

// Optional-in-the-database values are null when absent; anything else must pass the range.
function numOrNull(c: Collector, value: unknown, min: number, max: number, path: string, integer = false): number | null {
  return value === null ? null : num(c, value, min, max, path, integer);
}

function date(c: Collector, value: unknown, path: string): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    const year = parsed.getUTCFullYear();
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && year >= 2020 && year <= 2100) return value;
  }
  c.add('bad_value', path);
  return null;
}

function uuid(c: Collector, value: unknown, path: string): string | null {
  if (typeof value === 'string' && UUID_EXACT.test(value)) return value.toLowerCase();
  c.add('bad_value', path);
  return null;
}

type Clean = EvalScenario['context'];

function checkContext(c: Collector, raw: unknown): Clean | null {
  const context = recordAt(c, raw, 'context');
  if (!context) return null;
  strictKeys(c, context, ['profile', 'checkins', 'todayDayNumber', 'planDays', 'exercises'], 'context');
  const before = c.problems.length;

  // Profile
  let profile: Clean['profile'] = null;
  if (context.profile !== null) {
    const p = recordAt(c, context.profile, 'context.profile');
    if (p) {
      strictKeys(c, p, ['goal', 'trainingLevel', 'equipment', 'weightKg', 'heightCm', 'age', 'energySex', 'activityLevel'], 'context.profile');
      const goal = oneOf(c, p.goal, GOALS, 'context.profile.goal');
      const trainingLevel = oneOf(c, p.trainingLevel, LEVELS, 'context.profile.trainingLevel');
      const equipment = oneOf(c, p.equipment, EQUIPMENT, 'context.profile.equipment');
      const weightKg = num(c, p.weightKg, 30, 300, 'context.profile.weightKg');
      const heightCm = num(c, p.heightCm, 120, 230, 'context.profile.heightCm');
      const age = num(c, p.age, 18, 80, 'context.profile.age', true);
      const energySex = p.energySex === null ? null : oneOf(c, p.energySex, SEXES, 'context.profile.energySex');
      const activityLevel = p.activityLevel === null ? null : oneOf(c, p.activityLevel, ACTIVITY, 'context.profile.activityLevel');
      if (goal && trainingLevel && equipment && weightKg !== null && heightCm !== null && age !== null) {
        profile = { goal, trainingLevel, equipment, weightKg, heightCm, age, energySex, activityLevel } as Clean['profile'];
      }
    }
  }

  // Check-ins
  const checkins: Clean['checkins'] = [];
  for (const [i, item] of listAt(c, context.checkins, 'context.checkins', COACH_LIMITS.maxCheckins).entries()) {
    const k = recordAt(c, item, 'context.checkins');
    if (!k) continue;
    strictKeys(c, k, ['date', 'weightKg', 'mood', 'sleepHours'], 'context.checkins');
    const day = date(c, k.date, `context.checkins.${i}.date`);
    const weightKg = numOrNull(c, k.weightKg, 30, 300, `context.checkins.${i}.weightKg`);
    const mood = numOrNull(c, k.mood, 1, 5, `context.checkins.${i}.mood`, true);
    const sleepHours = numOrNull(c, k.sleepHours, 0, 24, `context.checkins.${i}.sleepHours`);
    if (day) checkins.push({ date: day, weightKg, mood, sleepHours });
  }

  const todayDayNumber = context.todayDayNumber === null ? null : num(c, context.todayDayNumber, 1, 120, 'context.todayDayNumber', true);

  // Exercises first: workouts may only use these.
  const exercises: Clean['exercises'] = [];
  for (const [i, item] of listAt(c, context.exercises, 'context.exercises', MAX_EXERCISES).entries()) {
    const e = recordAt(c, item, 'context.exercises');
    if (!e) continue;
    // An exercise has a name (Barbell squat); everywhere else a name would identify a person.
    strictKeys(c, e, ['id', 'name', 'pattern', 'equipment'], 'context.exercises');
    const id = uuid(c, e.id, `context.exercises.${i}.id`);
    const name = text(c, e.name, `context.exercises.${i}.name`, MAX_NAME_CHARS);
    const pattern = oneOf(c, e.pattern, PATTERNS, `context.exercises.${i}.pattern`);
    const equipment = oneOf(c, e.equipment, EQUIPMENT, `context.exercises.${i}.equipment`);
    if (name !== null) {
      if (!PLAIN_NAME.test(name)) c.add('bad_value', `context.exercises.${i}.name`);
      else if (hasContactDetail(name)) c.add('contact_detail', `context.exercises.${i}.name`);
      else if (looksIdentifying(name)) c.add('identifying_text', `context.exercises.${i}.name`);
    }
    if (id && name && pattern && equipment) exercises.push({ id, name, pattern, equipment });
  }
  const known = new Set(exercises.map((e) => e.id));

  // Plan days
  const planDays: Clean['planDays'] = [];
  const seenDays = new Set<number>();
  for (const [i, item] of listAt(c, context.planDays, 'context.planDays', COACH_LIMITS.horizonDays).entries()) {
    const d = recordAt(c, item, 'context.planDays');
    if (!d) continue;
    strictKeys(c, d, ['dayNumber', 'date', 'workout', 'calorieTarget', 'proteinTargetG'], 'context.planDays');
    const dayNumber = num(c, d.dayNumber, 1, 120, `context.planDays.${i}.dayNumber`, true);
    if (dayNumber !== null) {
      if (seenDays.has(dayNumber)) c.add('bad_value', `context.planDays.${i}.dayNumber`);
      seenDays.add(dayNumber);
    }
    const day = date(c, d.date, `context.planDays.${i}.date`);
    const calorieTarget = numOrNull(c, d.calorieTarget, 800, 6000, `context.planDays.${i}.calorieTarget`, true);
    const proteinTargetG = numOrNull(c, d.proteinTargetG, 20, 400, `context.planDays.${i}.proteinTargetG`, true);

    let workout: Clean['planDays'][number]['workout'] | null = null;
    const w = recordAt(c, d.workout, `context.planDays.${i}.workout`);
    if (w) {
      strictKeys(c, w, ['kind', 'exercises'], `context.planDays.${i}.workout`);
      const kind = oneOf(c, w.kind, ['workout', 'rest'] as const, `context.planDays.${i}.workout.kind`);
      if (kind === 'rest') {
        if (w.exercises !== undefined) c.add('bad_shape', `context.planDays.${i}.workout.exercises`);
        else workout = { kind: 'rest' };
      } else if (kind === 'workout') {
        const entries: { exercise_id: string; sets: number; reps: number }[] = [];
        for (const [j, entry] of listAt(c, w.exercises, `context.planDays.${i}.workout.exercises`, 20).entries()) {
          const x = recordAt(c, entry, `context.planDays.${i}.workout.exercises`);
          if (!x) continue;
          strictKeys(c, x, ['exercise_id', 'sets', 'reps'], `context.planDays.${i}.workout.exercises`);
          const exerciseId = uuid(c, x.exercise_id, `context.planDays.${i}.workout.exercises.${j}.exercise_id`);
          if (exerciseId && !known.has(exerciseId)) c.add('bad_value', `context.planDays.${i}.workout.exercises.${j}.exercise_id`);
          const sets = num(c, x.sets, 1, 6, `context.planDays.${i}.workout.exercises.${j}.sets`, true);
          const reps = num(c, x.reps, 1, 50, `context.planDays.${i}.workout.exercises.${j}.reps`, true);
          if (exerciseId && sets !== null && reps !== null) entries.push({ exercise_id: exerciseId, sets, reps });
        }
        workout = { kind: 'workout', exercises: entries };
      }
    }
    if (dayNumber !== null && day && workout) planDays.push({ dayNumber, date: day, workout, calorieTarget, proteinTargetG });
  }

  return c.problems.length === before ? { profile, checkins, todayDayNumber, planDays, exercises } : null;
}

// Expectation phrases are matched against replies, so they are short plain text and are scanned like the message.
function phrases(c: Collector, value: unknown, path: string): string[] {
  if (value === undefined) return [];
  const out: string[] = [];
  for (const item of listAt(c, value, path, MAX_PHRASES)) {
    const phrase = text(c, item, path, MAX_PHRASE_CHARS);
    if (phrase === null) continue;
    if (hasContactDetail(phrase)) c.add('contact_detail', path);
    else if (looksIdentifying(phrase)) c.add('identifying_text', path);
    out.push(phrase);
  }
  return out;
}

function parseOne(raw: unknown, index: number, seen: Set<string>): { scenario: EvalScenario | null; problems: ScenarioProblem[] } {
  const label = isRecord(raw) && typeof raw.id === 'string' && /^[a-z0-9-]{1,40}$/i.test(raw.id) ? raw.id : `#${index + 1}`;
  const c = new Collector(label);
  const value = recordAt(c, raw, 'scenario');
  if (!value) return { scenario: null, problems: c.problems };

  strictKeys(c, value, ['id', 'language', 'consent', 'deidentified', 'message', 'context', 'expectation'], 'scenario');
  // Declarations typed into the file. They gate loading but prove nothing: see the header comment.
  if (value.consent !== true) c.add('no_consent', 'consent');
  if (value.deidentified !== true) c.add('not_deidentified', 'deidentified');
  if (seen.has(label)) c.add('duplicate_id', 'id');
  seen.add(label);

  const language = COACH_LANGUAGES.find((code) => code === value.language);
  if (!language) c.add('bad_language', 'language');

  let message: string | null = null;
  if (typeof value.message !== 'string') c.add('bad_shape', 'message');
  else {
    const trimmed = value.message.trim();
    if (trimmed.length === 0 || trimmed.length > COACH_LIMITS.maxMessageChars || CONTROL.test(trimmed)) c.add('bad_value', 'message');
    else if (hasContactDetail(trimmed)) c.add('contact_detail', 'message');
    else if (looksIdentifying(trimmed)) c.add('identifying_text', 'message');
    else message = trimmed;
  }

  const context = checkContext(c, value.context);

  const expectation = recordAt(c, value.expectation, 'expectation');
  let parsed: ScenarioExpectation | null = null;
  if (expectation) {
    strictKeys(c, expectation, ['referral', 'proposal', 'mustMention', 'mustNotMention', 'forbidden'], 'expectation');
    if (typeof expectation.referral !== 'boolean') c.add('bad_shape', 'expectation.referral');
    const proposal = oneOf(c, expectation.proposal, ['required', 'none', 'optional'] as const, 'expectation.proposal');
    parsed = {
      referral: expectation.referral === true,
      proposal: proposal ?? 'none',
      mustMention: phrases(c, expectation.mustMention, 'expectation.mustMention'),
      mustNotMention: phrases(c, expectation.mustNotMention, 'expectation.mustNotMention'),
      forbidden: phrases(c, expectation.forbidden, 'expectation.forbidden'),
    };
  }

  if (c.problems.length > 0 || !language || !parsed || !context || message === null) return { scenario: null, problems: c.problems };
  return { scenario: { id: label, language, message, context, expectation: parsed }, problems: [] };
}

export function parseScenarios(raw: unknown): EvalScenario[] {
  if (!Array.isArray(raw)) throw new ScenarioRejected([{ scenarioId: '(file)', code: 'bad_shape', path: 'file' }]);
  if (raw.length === 0) throw new ScenarioRejected([{ scenarioId: '(file)', code: 'empty', path: 'file' }]);

  const seen = new Set<string>();
  const problems: ScenarioProblem[] = [];
  const scenarios: EvalScenario[] = [];
  raw.forEach((item, index) => {
    const result = parseOne(item, index, seen);
    problems.push(...result.problems);
    if (result.scenario) scenarios.push(result.scenario);
  });
  if (problems.length > 0) throw new ScenarioRejected(problems);
  return scenarios;
}

export function toContext(scenario: EvalScenario): CoachContext {
  return { ...scenario.context, language: scenario.language, languageFellBack: false };
}
