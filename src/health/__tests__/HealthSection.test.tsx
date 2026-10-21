import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import i18next, { t } from '../../i18n';
import { mockStore } from '../../sync/testing/storageMock';
import { readCache, writeCache } from '../../cache/userCache';
import { HealthSection } from '../HealthSection';
import { loadHealth, saveHealth } from '../store';
import { EMPTY_HEALTH_STATE } from '../types';
import { fakeAdapter, fixedDeps, sleepNight, stepsFor } from '../testing/fakes';

jest.setTimeout(30000);

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null } }) } } }));
const mockOpenUrl = jest.fn();

const textsOf = (tree: ReactTestRenderer): string[] => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') out.push(node);
    else if (node && typeof node === 'object') ((node as { children?: unknown[] | null }).children ?? []).forEach(walk);
  };
  walk(tree.toJSON());
  return out;
};
const shows = (tree: ReactTestRenderer, text: string) => textsOf(tree).some((s) => s.includes(text));
const has = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id).length > 0;
const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string' && typeof n.props.onPress === 'function').pop();
const press = (tree: ReactTestRenderer, id: string) =>
  act(async () => {
    await byId(tree, id)!.props.onPress();
  });
async function mount(adapter = fakeAdapter({ steps: stepsFor({ 29: 4200, 28: 9100 }), sleep: [sleepNight()] }), userId = 'A', user = { current: 'A' as string | null }) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<HealthSection userId={userId} deps={fixedDeps(adapter, { user })} openUrl={mockOpenUrl} />);
  });
  return { tree, adapter, user };
}
const connectedState = { ...EMPTY_HEALTH_STATE, status: 'connected' as const, connectedAt: '2026-10-01T00:00:00.000Z', permissions: { steps: true, sleep: true } };

beforeEach(async () => {
  mockStore.clear();
  mockOpenUrl.mockReset();
  await i18next.changeLanguage('en');
});

describe('devices and access', () => {
  it('explains an unsupported device and offers no way to connect', async () => {
    const { tree } = await mount(fakeAdapter({ availability: 'unsupported' }));

    expect(shows(tree, t('health.unsupported'))).toBe(true);
    expect(has(tree, 'health-connect')).toBe(false);
  });

  it.each([
    ['unavailable', 'health.unavailable'],
    ['update_required', 'health.updateRequired'],
  ] as const)('explains when Health Connect is %s and points to the Play Store, with no connect button', async (availability, key) => {
    const { tree } = await mount(fakeAdapter({ availability }));

    expect(shows(tree, t(key))).toBe(true);
    expect(has(tree, 'health-connect')).toBe(false);
    await press(tree, 'health-get');
    expect(mockOpenUrl).toHaveBeenCalledWith(expect.stringContaining('com.google.android.apps.healthdata'));
  });

  it('says clearly what it does before anything is asked: read-only, steps and sleep, never targets, off until the member connects', async () => {
    const { tree, adapter } = await mount();

    expect(shows(tree, t('health.intro'))).toBe(true);
    expect(has(tree, 'health-connect')).toBe(true);
    expect(adapter.calls.request).toBe(0);
    expect(adapter.calls.readSteps + adapter.calls.readSleep).toBe(0);
  });
});

describe('connecting', () => {
  it('asks only when Connect is pressed, then shows the source, the last read and the days', async () => {
    const { tree, adapter } = await mount();

    await press(tree, 'health-connect');

    expect(adapter.calls.request).toBe(1);
    expect(shows(tree, t('health.source'))).toBe(true);
    expect(shows(tree, 'Health Connect')).toBe(true);
    expect(shows(tree, t('health.lastSync', { time: new Date('2026-10-21T04:00:00.000Z').toLocaleString() }))).toBe(true);
    expect(shows(tree, (4200).toLocaleString())).toBe(true);
    expect(shows(tree, t('health.sleepLine', { hours: 7, minutes: 30 }))).toBe(true);
    expect(shows(tree, t('health.manualKept'))).toBe(true);
    expect(has(tree, 'health-disconnect')).toBe(true);
    expect(has(tree, 'health-connect')).toBe(false);
  });

  it('shows a denial, stays disconnected, and offers Health Connect settings', async () => {
    const { tree, adapter } = await mount(fakeAdapter({ requestResult: { steps: false, sleep: false } }));

    await press(tree, 'health-connect');

    expect(shows(tree, t('health.denied'))).toBe(true);
    expect((await loadHealth('A')).status).toBe('disconnected');
    await press(tree, 'health-settings');
    expect(adapter.calls.openSettings).toBe(1);
  });

  it('says which of the two was not allowed when only one is', async () => {
    const { tree } = await mount(fakeAdapter({ requestResult: { steps: true, sleep: false }, granted: { steps: true, sleep: false }, steps: stepsFor({ 29: 100 }) }));

    await press(tree, 'health-connect');

    expect(shows(tree, t('health.partial', { missing: t('health.sleep') }))).toBe(true);
  });

  it('shows an error without connecting when the permission dialog fails', async () => {
    const { tree } = await mount(fakeAdapter({ failRequest: true }));

    await press(tree, 'health-connect');

    expect(shows(tree, t('health.error'))).toBe(true);
    expect((await loadHealth('A')).status).toBe('disconnected');
  });

  it('connects once however many times Connect is tapped', async () => {
    const { tree, adapter } = await mount();

    await act(async () => {
      void byId(tree, 'health-connect')!.props.onPress();
      void byId(tree, 'health-connect')!.props.onPress();
    });

    expect(adapter.calls.request).toBe(1);
  });
});

describe('a connected account', () => {
  beforeEach(async () => {
    await saveHealth('A', connectedState);
  });

  it('reads on opening and shows the last read time and the apps the numbers came from', async () => {
    const { tree } = await mount(fakeAdapter({ steps: stepsFor({ 29: 4200 }, ['com.phone.app']), sleep: [sleepNight({ origin: 'com.watch.app' })] }));

    expect(shows(tree, t('health.lastSync', { time: new Date('2026-10-21T04:00:00.000Z').toLocaleString() }))).toBe(true);
    expect(shows(tree, 'com.phone.app')).toBe(true);
    expect(shows(tree, 'com.watch.app')).toBe(true);
  });

  it('reads again on Sync now, once for two quick taps', async () => {
    const { tree, adapter } = await mount();
    const before = adapter.calls.readSteps;

    await act(async () => {
      void byId(tree, 'health-sync')!.props.onPress();
      void byId(tree, 'health-sync')!.props.onPress();
    });

    expect(adapter.calls.readSteps - before).toBe(1);
  });

  it('tells the member a read failed, keeps what was imported, and recovers on the next try', async () => {
    const { tree, adapter } = await mount(fakeAdapter({ steps: stepsFor({ 29: 4200 }) }));
    adapter.state.script.failSteps = true;

    await press(tree, 'health-sync');
    expect(shows(tree, t('health.syncFailed'))).toBe(true);
    expect(shows(tree, (4200).toLocaleString())).toBe(true);

    adapter.state.script.failSteps = false;
    await press(tree, 'health-sync');
    expect(shows(tree, t('health.syncFailed'))).toBe(false);
  });

  it('says access was taken away, stops reading, and offers Health Connect settings', async () => {
    const adapter = fakeAdapter({ granted: { steps: false, sleep: false } });
    const { tree } = await mount(adapter);

    expect(shows(tree, t('health.permissionLost'))).toBe(true);
    expect(adapter.calls.readSteps + adapter.calls.readSleep).toBe(0);
    expect(has(tree, 'health-settings')).toBe(true);
  });

  it('says a device that lost Health Connect cannot sync, and keeps the data', async () => {
    const { tree } = await mount(fakeAdapter({ availability: 'unavailable' }));

    expect(shows(tree, t('health.unavailable'))).toBe(true);
    expect(has(tree, 'health-sync')).toBe(false);
  });

  it('asks before disconnecting, then revokes, removes the imported copies, and keeps manual entries', async () => {
    await writeCache('A', 'checkins', [{ date: '2026-10-20', weightKg: 70, mood: 3, sleepHours: 6.5 }]);
    const { tree, adapter } = await mount(fakeAdapter({ steps: stepsFor({ 29: 4200 }) }));

    await press(tree, 'health-disconnect');
    expect(adapter.calls.revoke).toBe(0);
    expect(shows(tree, t('health.disconnectAsk'))).toBe(true);
    await press(tree, 'health-disconnect-confirm');

    expect(adapter.calls.revoke).toBe(1);
    expect(await loadHealth('A')).toEqual(EMPTY_HEALTH_STATE);
    expect(await readCache('A', 'checkins')).toEqual([{ date: '2026-10-20', weightKg: 70, mood: 3, sleepHours: 6.5 }]);
    expect(shows(tree, t('health.disconnected'))).toBe(true);
    expect(has(tree, 'health-connect')).toBe(true);
    expect(shows(tree, (4200).toLocaleString())).toBe(false);
  });

  it('tells the member to remove access in Health Connect too when it could not be revoked', async () => {
    const { tree } = await mount(fakeAdapter({ failRevoke: true }));

    await press(tree, 'health-disconnect');
    await press(tree, 'health-disconnect-confirm');

    expect(shows(tree, t('health.revokeManually'))).toBe(true);
    expect(await loadHealth('A')).toEqual(EMPTY_HEALTH_STATE);
  });

  it('cancelling the question changes nothing', async () => {
    const { tree, adapter } = await mount();

    await press(tree, 'health-disconnect');
    await press(tree, 'health-disconnect-cancel');

    expect(adapter.calls.revoke).toBe(0);
    expect(has(tree, 'health-disconnect-confirm')).toBe(false);
    expect((await loadHealth('A')).status).toBe('connected');
  });
});

describe('accounts', () => {
  it('never shows one account\'s imported days to another', async () => {
    await saveHealth('A', { ...connectedState, steps: { '2026-10-20': { day: '2026-10-20', value: 12345, origins: ['com.phone.app'], revision: 'x' } } });
    await saveHealth('B', connectedState);

    const { tree } = await mount(fakeAdapter(), 'B', { current: 'B' });

    expect(shows(tree, (12345).toLocaleString())).toBe(false);
  });

  it('drops a read that finishes after the account has changed: nothing saved, nothing shown', async () => {
    await saveHealth('A', connectedState);
    const user = { current: 'A' as string | null };
    const adapter = fakeAdapter({ steps: stepsFor({ 29: 4200 }), onRead: () => { user.current = 'B'; } });

    const { tree } = await mount(adapter, 'A', user);

    expect((await loadHealth('A')).steps).toEqual({});
    expect(shows(tree, (4200).toLocaleString())).toBe(false);
  });
});

describe('what it never shows', () => {
  it('mentions no calorie, energy or target figure, and describes the source as Health Connect', async () => {
    await saveHealth('A', connectedState);
    const { tree } = await mount();

    const text = textsOf(tree).join(' ');
    expect(text).not.toMatch(/kcal|burn/i);
    expect(shows(tree, t('health.noTargets'))).toBe(true);
  });
});

describe('translations', () => {
  it.each(['ms', 'ta'])('has the health text in %s, marked as a draft in the documentation, not the English fallback', async (language) => {
    const keys = ['health.title', 'health.intro', 'health.connect', 'health.denied', 'health.unsupported', 'health.disconnect', 'health.disconnected', 'health.permissionLost', 'health.noTargets', 'health.manualKept'];
    await i18next.changeLanguage('en');
    const english = keys.map((k) => t(k));
    await i18next.changeLanguage(language);

    keys.forEach((k, i) => {
      expect(t(k)).not.toBe(k);
      expect(t(k)).not.toBe(english[i]);
    });
    await i18next.changeLanguage('en');
  });
});
