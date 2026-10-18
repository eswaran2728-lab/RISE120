// What today's session screen should do next. A session that has been started is the member's record: new
// preferences (time, place, energy) never replace it, and logged sets are never dropped.
export interface ActiveSession {
  sessionId: string;
  templateId: string;
  templateVersion: number;
  dayNumber: number;
  status: 'active' | 'completed';
  exercises: { exerciseId: string; sets: number; reps: number }[];
  loggedSets: { exerciseId: string }[];
}

export type NextStep =
  | { kind: 'choose' }
  | { kind: 'resume'; sessionId: string; completedSets: number; plannedSets: number }
  | { kind: 'done'; sessionId: string };

// Planned sets that have been logged. Extra sets, and sets of exercises that are not in the session, do not count.
export function completedSetCount(session: ActiveSession): number {
  return session.exercises.reduce((total, planned) => {
    const logged = session.loggedSets.filter((set) => set.exerciseId === planned.exerciseId).length;
    return total + Math.min(logged, planned.sets);
  }, 0);
}

export function nextStep(active: ActiveSession | null, dayNumber: number): NextStep {
  if (!active || active.dayNumber !== dayNumber) return { kind: 'choose' };
  if (active.status === 'completed') return { kind: 'done', sessionId: active.sessionId };
  return {
    kind: 'resume',
    sessionId: active.sessionId,
    completedSets: completedSetCount(active),
    plannedSets: active.exercises.reduce((total, e) => total + e.sets, 0),
  };
}
