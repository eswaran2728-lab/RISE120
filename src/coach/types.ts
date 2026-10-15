import type { PlanWorkout } from '../plan/types';

// Matches the server's message limit. The server is what enforces it; this only keeps the box honest.
export const COACH_MESSAGE_MAX_CHARS = 1000;
export const COACH_HISTORY_LIMIT = 30;

export type ProposalStatus = 'pending' | 'accepted' | 'declined' | 'stale';

export interface ProposalNext {
  workout?: PlanWorkout;
  calorieTarget?: number;
  proteinTargetG?: number;
}

export interface ProposalPatchView {
  dayNumber: number;
  // The plan's values when the proposal was made, set by the server.
  expected: { workout: PlanWorkout; calorieTarget: number | null; proteinTargetG: number | null };
  next: ProposalNext;
}

export interface CoachProposal {
  id: string;
  status: ProposalStatus;
  patches: ProposalPatchView[];
}

export interface CoachExchange {
  requestId: string;
  messageId: string;
  message: string;
  reply: string;
  language: string;
  createdAt: string | null;
  proposal: CoachProposal | null;
}
