// The choice the member made at the end of a cycle, remembered until the server has clearly answered. If no answer
// arrived (no connection), the same request id is used again, so retrying can never start a second cycle: the server
// answers the same id with the same cycle. The first choice is kept for the retry even if the member taps the other
// option, because the first request may already have succeeded.
import { clearCache, readCache, writeCache } from '../cache/userCache';
import { newLogId } from '../food/log';
import type { CycleMode } from './cycles';

export interface PendingCycle {
  requestId: string;
  mode: CycleMode;
}

const isPending = (value: unknown): value is PendingCycle =>
  typeof value === 'object' && value !== null && typeof (value as PendingCycle).requestId === 'string' && ((value as PendingCycle).mode === 'progression' || (value as PendingCycle).mode === 'maintenance');

export async function takePendingCycle(userId: string, mode: CycleMode): Promise<PendingCycle> {
  const existing = await readCache<unknown>(userId, 'cycle');
  if (isPending(existing)) return existing;
  const created: PendingCycle = { requestId: newLogId(), mode };
  await writeCache(userId, 'cycle', created);
  return created;
}

export const clearPendingCycle = (userId: string) => clearCache(userId, 'cycle');
