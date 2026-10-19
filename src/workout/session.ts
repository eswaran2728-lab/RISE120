import { readCache, writeCache } from '../cache/userCache';
import { loadLoggedSets } from '../plan/planData';
import { listPending } from '../sync/queue';
import type { LocalDate } from '../sync/types';
import { LoggedSet, mergeSets, SessionSet } from './log';

interface SetsCache {
  date: LocalDate;
  sets: LoggedSet[];
}

// The sets logged for a date: synced rows plus pending ones. If the server cannot be read, the
// last synced sets we saw for that date stand in, so set numbers never restart at 1 and
// overwrite a set that already synced.
export async function loadSessionSets(userId: string, date: LocalDate): Promise<SessionSet[]> {
  let synced: LoggedSet[];
  try {
    synced = await loadLoggedSets(userId, date);
    await writeCache(userId, 'sets', { date, sets: synced } satisfies SetsCache);
  } catch {
    const cached = await readCache<SetsCache>(userId, 'sets');
    synced = cached && cached.date === date ? cached.sets : [];
  }

  const pending = (await listPending(userId)).flatMap((op) =>
    op.kind === 'workout_set' && op.date === date
      ? [{ id: op.id, exerciseId: op.exerciseId, setNumber: op.setNumber, reps: op.reps, weightKg: op.weightKg, sessionId: op.sessionId ?? null }]
      : []
  );
  return mergeSets(synced, pending);
}
