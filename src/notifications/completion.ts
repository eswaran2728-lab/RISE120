// Whether the workout planned for a date is finished, by the same definition Today uses (isWorkoutComplete): the
// regular workout, or a guided session of that plan day. It reads the cached plan, the saved guided session and the
// sets logged for the date, including sets still waiting to sync. Anything unreadable counts as "not finished", so a
// reminder is never dropped because of a failed read; an unreadable guided session simply falls back to the regular
// workout.
import { loadPlanBundle } from '../plan/planData';
import { getPlanDay, isWorkoutComplete } from '../today/selectors';
import type { LocalDate } from '../sync/types';
import { loadGuidedProgress } from '../workout/guidedProgress';
import { loadSessionSets } from '../workout/session';

export async function workoutCompleteToday(userId: string, date: LocalDate): Promise<boolean> {
  try {
    const bundle = await loadPlanBundle(userId);
    if (!bundle) return false;
    const day = getPlanDay(bundle.plan, bundle.days, date);
    if (!day) return false;
    const [sets, guided] = await Promise.all([loadSessionSets(userId, date), loadGuidedProgress(userId, bundle.plan.id, day.dayNumber).catch(() => null)]);
    return isWorkoutComplete(day, sets, guided);
  } catch {
    return false;
  }
}
