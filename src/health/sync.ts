// One read of Health Connect into the member's imported copies. Read-only: it reads steps and sleep for the last 30 local days,
// works out one value per day, and replaces exactly those days. It never writes to Health Connect, never reads energy or any
// other data, and nothing it imports is used for a nutrition target.
import type { HealthAdapter } from './adapter';
import { buildWindow, localDate, OffsetAt } from './days';
import { reconcileDays, sleepByDay, stepsByDay } from './reconcile';
import { loadHealth, saveHealth } from './store';
import { HealthMetric, HealthState, SYNC_WINDOW_DAYS } from './types';

export interface HealthDeps {
  adapter: HealthAdapter;
  now(): Date;
  offsetAt: OffsetAt;
  // The account that is signed in right now, or null. A read for any other account is dropped, never saved.
  currentUserId(): string | null | Promise<string | null>;
}

export type SyncOutcome =
  | { kind: 'not_connected' }
  | { kind: 'unsupported'; availability: 'unsupported' | 'unavailable' | 'update_required' }
  | { kind: 'permission_lost' }
  | { kind: 'ok'; missing: HealthMetric[]; added: number; updated: number; removed: number }
  | { kind: 'failed' }
  | { kind: 'stale_account' };

// One sync per account at a time: a second request made while one runs gets the same answer.
const running = new Map<string, Promise<SyncOutcome>>();

export function syncHealth(userId: string, deps: HealthDeps): Promise<SyncOutcome> {
  const existing = running.get(userId);
  if (existing) return existing;
  const run = perform(userId, deps).finally(() => running.delete(userId));
  running.set(userId, run);
  return run;
}

async function remember(userId: string, state: HealthState, patch: Partial<HealthState>): Promise<void> {
  try {
    await saveHealth(userId, { ...state, ...patch });
  } catch {
    // Recording a failure is best effort.
  }
}

async function perform(userId: string, deps: HealthDeps): Promise<SyncOutcome> {
  const state = await loadHealth(userId);
  if (state.status !== 'connected') return { kind: 'not_connected' };

  const availability = await deps.adapter.availability();
  if (availability !== 'available') return { kind: 'unsupported', availability };

  let granted;
  try {
    granted = await deps.adapter.granted();
  } catch {
    await remember(userId, state, { lastSyncResult: 'failed' });
    return { kind: 'failed' };
  }
  if (!granted.steps && !granted.sleep) {
    // Access was taken away in Health Connect. Nothing is read; what was imported stays until the member disconnects.
    await remember(userId, state, { permissions: { steps: false, sleep: false } });
    return { kind: 'permission_lost' };
  }

  const nowMs = deps.now().getTime();
  const today = localDate(nowMs, deps.offsetAt);
  const window = buildWindow(today, SYNC_WINDOW_DAYS, deps.offsetAt);

  let steps;
  let sleep;
  try {
    // Both reads must succeed before anything is saved, so a failure never leaves a half-updated picture.
    steps = granted.steps ? stepsByDay(await deps.adapter.readSteps(window), window) : null;
    sleep = granted.sleep ? sleepByDay(await deps.adapter.readSleep(window), window, nowMs, deps.offsetAt) : null;
  } catch {
    if ((await deps.currentUserId()) === userId) await remember(userId, state, { lastSyncResult: 'failed' });
    return { kind: 'failed' };
  }

  // The account may have changed while Health Connect was being read; then this read belongs to nobody.
  if ((await deps.currentUserId()) !== userId) return { kind: 'stale_account' };

  // The member may have disconnected while the read ran; their removal of the copies must not be undone by this write.
  const latest = await loadHealth(userId);
  if (latest.status !== 'connected') return { kind: 'not_connected' };

  const nextSteps = steps ? reconcileDays(latest.steps, steps, window, today) : null;
  const nextSleep = sleep ? reconcileDays(latest.sleep, sleep, window, today) : null;
  const missing: HealthMetric[] = [...(granted.steps ? [] : (['steps'] as const)), ...(granted.sleep ? [] : (['sleep'] as const))];

  try {
    await saveHealth(userId, {
      ...latest,
      permissions: granted,
      lastSyncAt: deps.now().toISOString(),
      lastSyncResult: missing.length > 0 ? 'partial' : 'ok',
      steps: nextSteps ? nextSteps.next : latest.steps,
      sleep: nextSleep ? nextSleep.next : latest.sleep,
    });
  } catch {
    return { kind: 'failed' };
  }
  const sum = (key: 'added' | 'updated' | 'removed') => (nextSteps?.[key] ?? 0) + (nextSleep?.[key] ?? 0);
  return { kind: 'ok', missing, added: sum('added'), updated: sum('updated'), removed: sum('removed') };
}
