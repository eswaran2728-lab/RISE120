// Coming back after some days away. The suggestion is a calm, short, reviewed session, offered exactly as it was
// published: missed days are never turned into extra sets, and nothing is owed. The member can dismiss it, and
// it stays away for the rest of that day. With no reviewed session that fits there is simply no suggestion.
import { dayNumberFor } from '../lib/dates';
import type { LocalDate } from '../sync/types';
import { CatalogueInput, Equipment, Goal, Level, SessionTemplate } from '../workout/catalogue';
import { selectSession } from '../workout/sessionChoice';

export const RETURN_GAP_DAYS = 3;
export const RETURN_MAX_MINUTES = 20;

export interface ReturnInput {
  today: LocalDate;
  lastActivityDate: LocalDate | null; // the last day with a logged set or a check-in
  dismissedOn: LocalDate | null;
  equipment: Equipment;
  location: 'home' | 'gym';
  goal: Goal;
  level: Level;
}

export type ReturnSuggestion = { kind: 'none' } | { kind: 'fresh_start'; template: SessionTemplate; gapDays: number };

export function buildReturnSuggestion(input: ReturnInput, catalogue: CatalogueInput): ReturnSuggestion {
  if (!input.lastActivityDate || input.dismissedOn === input.today) return { kind: 'none' };
  const gapDays = dayNumberFor(input.lastActivityDate, input.today) - 1;
  if (gapDays < RETURN_GAP_DAYS) return { kind: 'none' };

  const choice = selectSession(
    { minutes: RETURN_MAX_MINUTES, location: input.location, equipment: input.equipment, energy: 'normal', goal: input.goal, level: input.level, dayType: 'training' },
    catalogue
  );
  return choice.available ? { kind: 'fresh_start', template: choice.template, gapDays } : { kind: 'none' };
}
