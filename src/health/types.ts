// Health data Rise120 may copy from Android Health Connect: steps and sleep, read-only, one value per local day. These
// copies are kept apart from anything the member typed (check-ins) and never replace it. There is deliberately no energy,
// heart-rate, weight or exercise type here, and nothing in this module may change a nutrition target.
export type HealthMetric = 'steps' | 'sleep';

// One imported day. `value` is a step count, or minutes asleep. `origins` are the apps (package names) the number came from.
export interface ImportedDay {
  day: string; // YYYY-MM-DD, the phone's local calendar day (a night belongs to the day the person woke up)
  value: number;
  origins: string[];
  revision: string; // changes whenever the value or its sources change
}

export interface HealthPermissions {
  steps: boolean;
  sleep: boolean;
}

export interface HealthState {
  version: 1;
  status: 'disconnected' | 'connected';
  permissions: HealthPermissions; // as last seen; the system can change them at any time
  connectedAt: string | null;
  lastSyncAt: string | null; // when Rise120 last read Health Connect successfully
  lastSyncResult: 'ok' | 'partial' | 'failed' | null;
  steps: Record<string, ImportedDay>;
  sleep: Record<string, ImportedDay>;
}

export const EMPTY_HEALTH_STATE: HealthState = {
  version: 1,
  status: 'disconnected',
  permissions: { steps: false, sleep: false },
  connectedAt: null,
  lastSyncAt: null,
  lastSyncResult: null,
  steps: {},
  sleep: {},
};

// How far back one read looks (Health Connect only allows 30 days before permission was granted without a separate
// history permission, which Rise120 does not ask for) and how many days of copies are kept.
export const SYNC_WINDOW_DAYS = 30;
export const KEEP_DAYS = 120;
