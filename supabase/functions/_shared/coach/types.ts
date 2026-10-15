// Shared types and pinned limits for the AI coach. Pure: no I/O. The model never writes the plan; everything it
// returns is parsed and checked (validate.ts) against the member's real plan before anything is stored.
import type { ActivityLevel, Equipment, EnergySex, Goal, Level, PlanWorkout } from '../plan/types.ts';

export type CoachLanguage = 'en' | 'ms' | 'ta';
export const COACH_LANGUAGES: readonly CoachLanguage[] = ['en', 'ms', 'ta'];

// Hard budgets, pinned in tests. These are safety and cost bounds, not plan limits (those come from app_config).
export const COACH_LIMITS = {
  maxMessageChars: 1000,
  maxReplyChars: 1500,
  maxOutputTokens: 700,
  maxCheckins: 10,
  maxPatches: 7,
  horizonDays: 14,
  providerTimeoutMs: 20000,
} as const;

// How far one proposal may move the plan. "Small, specific adjustment", never a rewrite.
export const COACH_BOUNDS = {
  earliestOffsetDays: 2, // first editable day = today's plan day (by UTC) + 2: safe for every time zone
  maxCalorieDelta: 250,
  setsMin: 1,
  setsMax: 6,
  maxSetsDelta: 1,
  repsMin: 4,
  repsMax: 20,
  maxRepsDelta: 2,
} as const;

export interface CoachProfile {
  goal: Goal;
  trainingLevel: Level;
  equipment: Equipment;
  weightKg: number;
  heightCm: number;
  age: number;
  energySex: EnergySex | null;
  activityLevel: ActivityLevel | null;
}

export interface CoachCheckin {
  date: string; // YYYY-MM-DD
  weightKg: number | null;
  mood: number | null;
  sleepHours: number | null;
}

// A plan day the member may still change (future and currently accessible).
export interface CoachPlanDay {
  dayNumber: number;
  date: string;
  workout: PlanWorkout;
  calorieTarget: number | null;
  proteinTargetG: number | null;
}

export interface CoachExercise {
  id: string;
  name: string;
  pattern: string; // movement pattern: squat, hinge, push, pull or core
  equipment: string;
}

// Everything the coach may see. No user id, email, name, food preferences, photo or plan id is in here.
export interface CoachContext {
  language: CoachLanguage;
  languageFellBack: boolean;
  profile: CoachProfile | null;
  checkins: CoachCheckin[]; // newest first, at most COACH_LIMITS.maxCheckins
  todayDayNumber: number | null;
  planDays: CoachPlanDay[];
  exercises: CoachExercise[]; // the member's own equipment group only
}

export interface CoachProposalNext {
  workout?: PlanWorkout;
  calorieTarget?: number;
  proteinTargetG?: number;
}

export interface CoachProposalPatch {
  dayNumber: number;
  // The plan's real values when the proposal was made, set by the server (never taken from the model). A later
  // decision applies the change only if the day still matches.
  expected?: { workout: PlanWorkout; calorieTarget: number | null; proteinTargetG: number | null };
  next: CoachProposalNext;
}

export interface CoachProposal {
  patches: CoachProposalPatch[];
}

export interface CoachReply {
  text: string;
  proposal: CoachProposal | null;
  refused?: boolean; // the provider declined; text is the safe referral message
  droppedProposal?: string[]; // why a proposed change was removed (reasons, not member-facing text)
}

export interface CoachProvider {
  generate(context: CoachContext, message: string): Promise<CoachReply>;
}

export type CoachProviderErrorKind = 'unavailable' | 'timeout' | 'invalid' | 'misconfigured';

export class CoachProviderError extends Error {
  readonly kind: CoachProviderErrorKind;
  // True when the request may have reached the provider and produced an answer we never saw. Such a request must
  // not be regenerated automatically on the same request id.
  readonly outcomeUnknown: boolean;

  constructor(kind: CoachProviderErrorKind, outcomeUnknown: boolean, message: string) {
    super(message);
    this.name = 'CoachProviderError';
    this.kind = kind;
    this.outcomeUnknown = outcomeUnknown;
    Object.setPrototypeOf(this, CoachProviderError.prototype);
  }
}

export class CoachValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoachValidationError';
    Object.setPrototypeOf(this, CoachValidationError.prototype);
  }
}
