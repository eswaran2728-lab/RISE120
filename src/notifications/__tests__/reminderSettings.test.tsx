import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { ReminderSettings } from '../ReminderSettings';
import { REMINDER_HORIZON_DAYS, type NotificationApi, type PermissionState } from '../adapter';
import { loadReminders } from '../preferences';
import { mockStore } from '../../sync/testing/storageMock';
import { t } from '../../i18n';

jest.mock('../completion', () => ({ workoutCompleteToday: jest.fn(async () => false) }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

const NOW = new Date('2026-10-18T01:00:00Z'); // 09:00 in Kuala Lumpur

function fakeApi(start: PermissionState = 'granted') {
  let current = start;
  const scheduled = new Map<string, { at: Date; title: string; body: string }>();
  const api: NotificationApi & { scheduled: typeof scheduled } = {
    scheduled,
    permission: jest.fn(async () => current),
    requestPermission: jest.fn(async () => {
      if (current === 'undetermined') current = 'denied';
      return current;
    }),
    schedule: jest.fn(async (id, at, title, body) => void scheduled.set(id, { at, title, body })),
    cancel: jest.fn(async (id) => void scheduled.delete(id)),
    scheduledIds: jest.fn(async () => [...scheduled.keys()]),
  };
  return Object.assign(api, { grantOnAsk: () => (api.requestPermission = jest.fn(async () => (current = 'granted'))) });
}

const earliest = (api: { scheduled: Map<string, { at: Date }> }) => [...api.scheduled.values()].map((v) => v.at).sort((a, b) => a.getTime() - b.getTime())[0];
const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== 'string' && (typeof n.props.onPress === 'function' || typeof n.props.onValueChange === 'function')).pop();
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

let complete = jest.fn(async () => false);
async function mount(api: NotificationApi, userId = 'A') {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<ReminderSettings userId={userId} api={api} now={() => NOW} timeZone="Asia/Kuala_Lumpur" isWorkoutComplete={complete} />);
  });
  return tree;
}
const toggle = (tree: ReactTestRenderer, id: string, value: boolean) =>
  act(async () => {
    await byId(tree, id)!.props.onValueChange(value);
  });
const press = (tree: ReactTestRenderer, id: string) =>
  act(async () => {
    await byId(tree, id)!.props.onPress();
  });

beforeEach(() => {
  mockStore.clear();
  complete = jest.fn(async () => false);
});

describe('reminder settings', () => {
  it('starts switched off and schedules nothing', async () => {
    const api = fakeApi();
    const tree = await mount(api);

    expect(byId(tree, 'reminder-enabled')!.props.value).toBe(false);
    expect(api.scheduled.size).toBe(0);
    expect(api.requestPermission).not.toHaveBeenCalled();
  });

  it('turning on asks permission, saves the choice and schedules one generic notification', async () => {
    const api = fakeApi('undetermined');
    api.grantOnAsk();
    const tree = await mount(api);

    await toggle(tree, 'reminder-enabled', true);

    expect(byId(tree, 'reminder-enabled')!.props.value).toBe(true);
    expect((await loadReminders('A')).enabled).toBe(true);
    expect(api.scheduled.size).toBe(REMINDER_HORIZON_DAYS);
    const first = [...api.scheduled.values()].sort((a, b) => a.at.getTime() - b.at.getTime())[0];
    expect(first).toMatchObject({ title: t('reminders.title'), body: t('reminders.body'), at: new Date('2026-10-18T10:00:00Z') });
  });

  it('stays off and says why when the person refuses permission', async () => {
    const api = fakeApi('undetermined');
    const tree = await mount(api);

    await toggle(tree, 'reminder-enabled', true);

    expect(byId(tree, 'reminder-enabled')!.props.value).toBe(false);
    expect((await loadReminders('A')).enabled).toBe(false);
    expect(api.scheduled.size).toBe(0);
    expect(shows(tree, t('reminders.denied'))).toBe(true);
  });

  it('moves the reminder when another time is chosen', async () => {
    const api = fakeApi();
    const tree = await mount(api);
    await toggle(tree, 'reminder-enabled', true);

    await press(tree, 'reminder-time-0630');

    expect((await loadReminders('A')).time).toBe('06:30');
    expect(earliest(api)).toEqual(new Date('2026-10-18T22:30:00Z')); // 06:30 tomorrow, the time having passed
    expect(api.scheduled.size).toBe(REMINDER_HORIZON_DAYS);
  });

  it('keeps reminders out of quiet hours when they are switched on', async () => {
    const api = fakeApi();
    const tree = await mount(api);
    await toggle(tree, 'reminder-enabled', true);
    await press(tree, 'reminder-time-0630');

    await toggle(tree, 'reminder-quiet', true);

    const saved = await loadReminders('A');
    expect([saved.quietStart, saved.quietEnd]).toEqual(['21:00', '07:00']);
    expect(earliest(api)).toEqual(new Date('2026-10-18T23:00:00Z')); // 07:00 next morning
  });

  it('turning off cancels the scheduled reminder', async () => {
    const api = fakeApi();
    const tree = await mount(api);
    await toggle(tree, 'reminder-enabled', true);

    await toggle(tree, 'reminder-enabled', false);

    expect(api.scheduled.size).toBe(0);
    expect((await loadReminders('A')).enabled).toBe(false);
  });

  it('shows what was saved earlier for this account', async () => {
    const api = fakeApi();
    const first = await mount(api);
    await toggle(first, 'reminder-enabled', true);
    await press(first, 'reminder-time-0630');

    const again = await mount(fakeApi());

    expect(byId(again, 'reminder-enabled')!.props.value).toBe(true);
  });

  it('leaves out the reminder for today when the workout for today is already complete', async () => {
    complete.mockResolvedValue(true);
    const api = fakeApi();
    const tree = await mount(api);

    await toggle(tree, 'reminder-enabled', true);

    expect(earliest(api)).toEqual(new Date('2026-10-19T10:00:00Z'));
  });
});
