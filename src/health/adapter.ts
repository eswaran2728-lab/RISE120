// The one place that talks to Android Health Connect (through react-native-health-connect). Everything else in
// src/health works against the HealthAdapter interface, so it is tested without a device. This adapter is READ-ONLY and asks
// for exactly two permissions, steps and sleep: it never writes, never deletes, and never asks for energy, heart rate or
// anything else.
import { Platform } from 'react-native';
import type { DayWindow } from './days';
import type { RawSleep } from './reconcile';
import type { HealthPermissions } from './types';

// 'unsupported': not Android, Android older than 9, or a build without the native module. 'unavailable': Health
// Connect is not installed (Android 13 and below). 'update_required': its app needs updating.
export type Availability = 'unsupported' | 'unavailable' | 'update_required' | 'available';

export interface StepsGroup {
  count: number | null;
  origins: string[];
}

export interface HealthAdapter {
  availability(): Promise<Availability>;
  granted(): Promise<HealthPermissions>;
  request(): Promise<HealthPermissions>;
  // One entry per day of the window, in order.
  readSteps(window: DayWindow): Promise<StepsGroup[]>;
  readSleep(window: DayWindow): Promise<RawSleep[]>;
  // Asks Health Connect to drop this app's access. On Android 14 and later the system only applies it when the app restarts.
  revoke(): Promise<void>;
  openSettings(): void;
}

// The permissions this feature may ever hold. Tests pin this list.
export const READ_PERMISSIONS = [
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'SleepSession' },
] as const;

const MIN_ANDROID_API = 28; // the Health Connect app needs Android 9
const MAX_PAGES = 20;
const PAGE_SIZE = 500;
const PROVIDER_STATUS = { SDK_UNAVAILABLE: 1, SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2, SDK_AVAILABLE: 3 };

type Library = any;

export interface AdapterOptions {
  platform?: { OS: string; Version: string | number };
  // Loads the native library lazily; failing to load means this build has no Health Connect support.
  loadLibrary?: () => Library;
}

export function createHealthConnectAdapter(options: AdapterOptions = {}): HealthAdapter {
  const platform = options.platform ?? Platform;
  const load = options.loadLibrary ?? (() => require('react-native-health-connect')); // eslint-disable-line @typescript-eslint/no-require-imports
  let initialised = false;

  const supportedPlatform = () => platform.OS === 'android' && Number(platform.Version) >= MIN_ANDROID_API;
  const library = (): Library => load();
  const ready = async (): Promise<Library> => {
    const lib = library();
    if (!initialised) {
      await lib.initialize();
      initialised = true;
    }
    return lib;
  };
  const toPermissions = (list: { accessType?: string; recordType?: string }[]): HealthPermissions => ({
    steps: list.some((p) => p.accessType === 'read' && p.recordType === 'Steps'),
    sleep: list.some((p) => p.accessType === 'read' && p.recordType === 'SleepSession'),
  });

  return {
    async availability() {
      if (!supportedPlatform()) return 'unsupported';
      try {
        const status = await library().getSdkStatus();
        if (status === PROVIDER_STATUS.SDK_AVAILABLE) return 'available';
        if (status === PROVIDER_STATUS.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'update_required';
        return status === PROVIDER_STATUS.SDK_UNAVAILABLE ? 'unavailable' : 'unsupported';
      } catch {
        return 'unsupported'; // the native module is not in this build
      }
    },

    async granted() {
      const lib = await ready();
      return toPermissions(await lib.getGrantedPermissions());
    },

    async request() {
      const lib = await ready();
      return toPermissions(await lib.requestPermission(READ_PERMISSIONS.map((p) => ({ ...p }))));
    },

    async readSteps(window) {
      const lib = await ready();
      const groups: { result?: { COUNT_TOTAL?: unknown; dataOrigins?: unknown }; startTime?: unknown }[] = await lib.aggregateGroupByPeriod({
        recordType: 'Steps',
        timeRangeFilter: { operator: 'between', startTime: window.starts[0], endTime: window.end },
        timeRangeSlicer: { period: 'DAYS', length: 1 },
      });
      if (!Array.isArray(groups) || groups.length !== window.days.length) throw new Error('health_steps_misaligned');
      return groups.map((group, index) => {
        // Each group must be the local day we expect; if Health Connect labelled it differently, stop rather than mislabel.
        const label = typeof group.startTime === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(group.startTime)?.[0] : undefined;
        if (label && label !== window.days[index]) throw new Error('health_steps_misaligned');
        const count = group.result?.COUNT_TOTAL;
        const origins = group.result?.dataOrigins;
        return { count: typeof count === 'number' ? count : null, origins: Array.isArray(origins) ? origins.filter((o): o is string => typeof o === 'string') : [] };
      });
    },

    async readSleep(window) {
      const lib = await ready();
      const sessions: RawSleep[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const response = await lib.readRecords('SleepSession', {
          timeRangeFilter: { operator: 'between', startTime: window.starts[0], endTime: window.end },
          ascendingOrder: true,
          pageSize: PAGE_SIZE,
          ...(pageToken ? { pageToken } : {}),
        });
        for (const record of response?.records ?? []) {
          const offset = record.endZoneOffset?.totalSeconds;
          sessions.push({
            id: record.metadata?.id ?? null,
            origin: record.metadata?.dataOrigin ?? null,
            start: record.startTime,
            end: record.endTime,
            endOffsetMinutes: typeof offset === 'number' ? offset / 60 : null,
            stages: Array.isArray(record.stages) ? record.stages.map((s: { startTime: string; endTime: string; stage: number }) => ({ start: s.startTime, end: s.endTime, type: s.stage })) : null,
          });
        }
        pageToken = response?.pageToken || undefined;
        if (!pageToken) break;
      }
      return sessions;
    },

    async revoke() {
      const lib = await ready();
      await lib.revokeAllPermissions();
    },

    openSettings() {
      library().openHealthConnectSettings();
    },
  };
}

export const healthConnectAdapter = createHealthConnectAdapter();
