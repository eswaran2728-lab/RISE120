// Test doubles for the health tests: a scripted adapter and fixed dependencies. SYNTHETIC data only.
import type { Availability, HealthAdapter, StepsGroup } from '../adapter';
import type { HealthDeps } from '../sync';
import type { DayWindow } from '../days';
import type { RawSleep } from '../reconcile';
import type { HealthPermissions } from '../types';

export interface FakeScript {
  availability?: Availability;
  granted?: HealthPermissions;
  requestResult?: HealthPermissions;
  steps?: (window: DayWindow) => StepsGroup[];
  sleep?: RawSleep[];
  failSteps?: boolean;
  failSleep?: boolean;
  failRequest?: boolean;
  failRevoke?: boolean;
  onRead?: () => void;
}

export function fakeAdapter(script: FakeScript = {}) {
  const calls = { availability: 0, granted: 0, request: 0, readSteps: 0, readSleep: 0, revoke: 0, openSettings: 0 };
  const state = { script: { availability: 'available' as Availability, granted: { steps: true, sleep: true }, requestResult: { steps: true, sleep: true }, ...script } };
  const adapter: HealthAdapter & { calls: typeof calls; state: typeof state } = {
    calls,
    state,
    async availability() {
      calls.availability += 1;
      return state.script.availability;
    },
    async granted() {
      calls.granted += 1;
      return state.script.granted;
    },
    async request() {
      calls.request += 1;
      if (state.script.failRequest) throw new Error('permission dialog failed');
      return state.script.requestResult;
    },
    async readSteps(window) {
      calls.readSteps += 1;
      state.script.onRead?.();
      if (state.script.failSteps) throw new Error('Health Connect unavailable');
      return state.script.steps ? state.script.steps(window) : window.days.map(() => ({ count: null, origins: [] }));
    },
    async readSleep() {
      calls.readSleep += 1;
      state.script.onRead?.();
      if (state.script.failSleep) throw new Error('Health Connect unavailable');
      return state.script.sleep ?? [];
    },
    async revoke() {
      calls.revoke += 1;
      if (state.script.failRevoke) throw new Error('revoke failed');
    },
    openSettings() {
      calls.openSettings += 1;
    },
  };
  return adapter;
}

// 21 October 2026, 12:00 in Malaysia.
export const NOW = new Date('2026-10-21T04:00:00Z');

export function fixedDeps(adapter: HealthAdapter, over: Partial<HealthDeps> & { user?: { current: string | null } } = {}): HealthDeps {
  const user = over.user ?? { current: 'A' };
  return { adapter, now: () => NOW, offsetAt: () => 480, currentUserId: () => user.current, ...over };
}

// A steps script giving the same number for every day of the window except where overridden by index.
export const stepsFor = (values: Record<number, number>, origins = ['com.phone.app']) => (window: DayWindow): StepsGroup[] =>
  window.days.map((_, index) => (values[index] !== undefined ? { count: values[index], origins } : { count: null, origins: [] }));

export const sleepNight = (over: Partial<RawSleep> = {}): RawSleep => ({ id: 's1', origin: 'com.watch.app', start: '2026-10-19T15:00:00Z', end: '2026-10-19T22:30:00Z', endOffsetMinutes: 480, stages: null, ...over });
