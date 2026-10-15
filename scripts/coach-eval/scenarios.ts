// Evaluation scenarios: consented, deidentified check-ins used to compare coach providers. The loader is a gate,
// not a convenience: a scenario that lacks consent, carries an identifying field or photo, or has any field this
// file does not know is rejected, and the WHOLE file is refused rather than skipped. Errors name the scenario id,
// a code and a field path, never the rejected value, so private text cannot reach a log.
import type { CoachContext, CoachLanguage } from '../../supabase/functions/_shared/coach/types.ts';
import { COACH_LANGUAGES } from '../../supabase/functions/_shared/coach/types.ts';

export type ProposalExpectation = 'required' | 'none' | 'optional';

export interface ScenarioExpectation {
  referral: boolean; // the member needs a health professional, not training advice
  proposal: ProposalExpectation;
  mustMention: string[]; // facts from the check-in the reply must repeat
  mustNotMention: string[]; // numbers or claims that would be invented
  forbidden: string[]; // phrases that make a reply unsafe
}

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

const PHOTO_KEY = /(photo|image|img|picture|selfie|avatar|video)/i;
const IDENTIFYING_KEY = /^(user_?id|account_?id|plan_?id|e_?mail|full_?name|first_?name|last_?name|name|phone|mobile|tel|address|dob|birth|ic|nric|passport|ip|location|gps)/i;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LINK = /(https?:\/\/|www\.)/i;
const DATA_URI = /data:[a-z]+\/[a-z0-9.+-]+;base64/i;
const IMAGE_FILE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)\b/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function hasPhoneNumber(text: string): boolean {
  for (const match of text.matchAll(/\+?\d[\d\s().-]{6,}\d/g)) {
    if (match[0].replace(/\D/g, '').length >= 9) return true;
  }
  return false;
}

function hasContactDetail(text: string): boolean {
  return EMAIL.test(text) || LINK.test(text) || DATA_URI.test(text) || IMAGE_FILE.test(text) || UUID.test(text) || hasPhoneNumber(text);
}

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

function listAt(c: Collector, value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  c.add('bad_shape', path);
  return [];
}

function stringList(c: Collector, value: unknown, path: string): string[] {
  if (value === undefined) return [];
  const list = listAt(c, value, path);
  if (!list.every((item) => typeof item === 'string')) c.add('bad_shape', path);
  return list.filter((item): item is string => typeof item === 'string');
}

function checkContext(c: Collector, raw: unknown) {
  const context = recordAt(c, raw, 'context');
  if (!context) return;
  strictKeys(c, context, ['profile', 'checkins', 'todayDayNumber', 'planDays', 'exercises'], 'context');

  if (context.profile !== null) {
    const profile = recordAt(c, context.profile, 'context.profile');
    if (profile) strictKeys(c, profile, ['goal', 'trainingLevel', 'equipment', 'weightKg', 'heightCm', 'age', 'energySex', 'activityLevel'], 'context.profile');
  }
  for (const item of listAt(c, context.checkins, 'context.checkins')) {
    const checkin = recordAt(c, item, 'context.checkins');
    if (checkin) strictKeys(c, checkin, ['date', 'weightKg', 'mood', 'sleepHours'], 'context.checkins');
  }
  for (const item of listAt(c, context.planDays, 'context.planDays')) {
    const day = recordAt(c, item, 'context.planDays');
    if (!day) continue;
    strictKeys(c, day, ['dayNumber', 'date', 'workout', 'calorieTarget', 'proteinTargetG'], 'context.planDays');
    const workout = recordAt(c, day.workout, 'context.planDays.workout');
    if (!workout) continue;
    strictKeys(c, workout, ['kind', 'exercises'], 'context.planDays.workout');
    for (const entry of workout.exercises === undefined ? [] : listAt(c, workout.exercises, 'context.planDays.workout.exercises')) {
      const e = recordAt(c, entry, 'context.planDays.workout.exercises');
      if (e) strictKeys(c, e, ['exercise_id', 'sets', 'reps'], 'context.planDays.workout.exercises');
    }
  }
  for (const item of listAt(c, context.exercises, 'context.exercises')) {
    const exercise = recordAt(c, item, 'context.exercises');
    if (!exercise) continue;
    // An exercise has a name (Barbell squat); everywhere else a name would identify a person.
    strictKeys(c, exercise, ['id', 'name', 'pattern', 'equipment'], 'context.exercises');
    if (typeof exercise.name === 'string' && hasContactDetail(exercise.name)) c.add('contact_detail', 'context.exercises.name');
  }
}

function parseOne(raw: unknown, index: number, seen: Set<string>): { scenario: EvalScenario | null; problems: ScenarioProblem[] } {
  const label = isRecord(raw) && typeof raw.id === 'string' && /^[a-z0-9-]{1,40}$/i.test(raw.id) ? raw.id : `#${index + 1}`;
  const c = new Collector(label);
  const value = recordAt(c, raw, 'scenario');
  if (!value) return { scenario: null, problems: c.problems };

  strictKeys(c, value, ['id', 'language', 'consent', 'deidentified', 'message', 'context', 'expectation'], 'scenario');
  if (value.consent !== true) c.add('no_consent', 'consent');
  if (value.deidentified !== true) c.add('not_deidentified', 'deidentified');
  if (seen.has(label)) c.add('duplicate_id', 'id');
  seen.add(label);

  const language = COACH_LANGUAGES.find((code) => code === value.language);
  if (!language) c.add('bad_language', 'language');
  if (typeof value.message !== 'string' || value.message.trim().length === 0) c.add('bad_shape', 'message');
  else if (hasContactDetail(value.message)) c.add('contact_detail', 'message');

  checkContext(c, value.context);

  const expectation = recordAt(c, value.expectation, 'expectation');
  let parsed: ScenarioExpectation | null = null;
  if (expectation) {
    strictKeys(c, expectation, ['referral', 'proposal', 'mustMention', 'mustNotMention', 'forbidden'], 'expectation');
    if (typeof expectation.referral !== 'boolean') c.add('bad_shape', 'expectation.referral');
    if (!['required', 'none', 'optional'].includes(expectation.proposal as string)) c.add('bad_shape', 'expectation.proposal');
    parsed = {
      referral: expectation.referral === true,
      proposal: expectation.proposal as ProposalExpectation,
      mustMention: stringList(c, expectation.mustMention, 'expectation.mustMention'),
      mustNotMention: stringList(c, expectation.mustNotMention, 'expectation.mustNotMention'),
      forbidden: stringList(c, expectation.forbidden, 'expectation.forbidden'),
    };
  }

  if (c.problems.length > 0 || !language || !parsed) return { scenario: null, problems: c.problems };
  return {
    scenario: { id: label, language, message: (value.message as string).trim(), context: value.context as EvalScenario['context'], expectation: parsed },
    problems: [],
  };
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
