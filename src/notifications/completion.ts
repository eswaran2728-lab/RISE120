// Whether the workout planned for a date is finished, from the same data Today uses: the cached plan and the sets
// logged for the date, including sets still waiting to sync. Anything unreadable counts as "not finished", so a
// reminder is never dropped because of a failed read.
import { loadPlanBundle } from '../plan/planData';
import { getPlanDay, isWorkoutComplete } from '../today/selectors';
import type { LocalDate } from '../sync/types';
import { loadSessionSets } from '../workout/session';

export async function workoutCompleteToday(userId: string, date: LocalDate): Promise<boolean> {
  try {
    const bundle = await loadPlanBundle(userId);
    if (!bundle) return false;
    const day = getPlanDay(bundle.plan, bundle.days, date);
    if (!day) return false;
    return isWorkoutComplete(day, await loadSessionSets(userId, date));
  } catch {
    return false;
  }
}
