// Connecting and disconnecting. Both are the member's choice, one account at a time. Nothing is requested until the member taps
// Connect, only steps and sleep are ever asked for, and disconnecting removes every imported copy Rise120 holds while leaving
// everything the member typed alone.
import { localDate } from './days';
import { loadHealth, removeHealth, saveHealth } from './store';
import { HealthMetric } from './types';
import { HealthDeps, SyncOutcome, syncHealth } from './sync';

export type ConnectOutcome =
  | { kind: 'unsupported' | 'unavailable' | 'update_required' }
  | { kind: 'denied' }
  | { kind: 'connected'; partial: HealthMetric[]; sync: SyncOutcome }
  | { kind: 'stale_account' }
  | { kind: 'error' };

export async function connectHealth(userId: string, deps: HealthDeps): Promise<ConnectOutcome> {
  const availability = await deps.adapter.availability();
  if (availability !== 'available') return { kind: availability };

  let granted;
  try {
    granted = await deps.adapter.request();
  } catch {
    return { kind: 'error' };
  }
  // The permission dialog can stay open a while; if the account changed meanwhile, nothing is saved for anyone.
  if ((await deps.currentUserId()) !== userId) return { kind: 'stale_account' };
  if (!granted.steps && !granted.sleep) return { kind: 'denied' };

  const state = await loadHealth(userId);
  try {
    await saveHealth(userId, {
      ...state,
      status: 'connected',
      permissions: granted,
      connectedAt: new Date(deps.now().getTime()).toISOString(),
    });
  } catch {
    return { kind: 'error' };
  }
  const sync = await syncHealth(userId, deps);
  return { kind: 'connected', partial: [...(granted.steps ? [] : (['steps'] as const)), ...(granted.sleep ? [] : (['sleep'] as const))], sync };
}

export type DisconnectOutcome = { kind: 'disconnected'; revoked: boolean };

// Asks Health Connect to drop the app's access (on Android 14 and later the system applies that when the app restarts, so the
// screen also points the member to Health Connect), then removes this account's imported copies. Removal does not wait on the
// revoke: a failed revoke must never leave imported data behind.
export async function disconnectHealth(userId: string, deps: HealthDeps): Promise<DisconnectOutcome> {
  let revoked = true;
  try {
    await deps.adapter.revoke();
  } catch {
    revoked = false;
  }
  await removeHealth(userId);
  return { kind: 'disconnected', revoked };
}

export { localDate };
