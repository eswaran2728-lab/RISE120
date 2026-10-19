// What a finished session actually contained: the sets that were logged, never the planned volume.
export interface ExerciseTotals {
  exerciseId: string;
  name: string;
  sets: number;
  reps: number;
  volumeKg: number;
}

export interface SessionSummary {
  setsCompleted: number;
  totalReps: number;
  volumeKg: number;
  byExercise: ExerciseTotals[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summariseSets(sets: { exerciseId: string; name: string; reps: number; weightKg: number }[]): SessionSummary {
  const groups = new Map<string, ExerciseTotals>();
  for (const set of sets) {
    const group = groups.get(set.exerciseId) ?? { exerciseId: set.exerciseId, name: set.name, sets: 0, reps: 0, volumeKg: 0 };
    group.sets += 1;
    group.reps += set.reps;
    group.volumeKg += set.reps * set.weightKg;
    groups.set(set.exerciseId, group);
  }
  const byExercise = [...groups.values()].map((g) => ({ ...g, volumeKg: round1(g.volumeKg) })).sort((a, b) => a.name.localeCompare(b.name) || a.exerciseId.localeCompare(b.exerciseId));
  return {
    setsCompleted: byExercise.reduce((n, g) => n + g.sets, 0),
    totalReps: byExercise.reduce((n, g) => n + g.reps, 0),
    volumeKg: round1(byExercise.reduce((n, g) => n + g.volumeKg, 0)),
    byExercise,
  };
}

// Reads a summary the server recorded. Anything that is not exactly the expected shape is refused.
export function parseSummary(raw: unknown): SessionSummary | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.setsCompleted !== 'number' || typeof r.totalReps !== 'number' || typeof r.volumeKg !== 'number' || !Array.isArray(r.byExercise)) return null;
  const byExercise: ExerciseTotals[] = [];
  for (const entry of r.byExercise) {
    const e = entry as Record<string, unknown> | null;
    if (!e || typeof e.exerciseId !== 'string' || typeof e.name !== 'string' || typeof e.sets !== 'number' || typeof e.reps !== 'number' || typeof e.volumeKg !== 'number') return null;
    byExercise.push({ exerciseId: e.exerciseId, name: e.name, sets: e.sets, reps: e.reps, volumeKg: e.volumeKg });
  }
  return { setsCompleted: r.setsCompleted, totalReps: r.totalReps, volumeKg: r.volumeKg, byExercise };
}
