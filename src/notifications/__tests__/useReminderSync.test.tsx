import React from 'react';
import { AppState } from 'react-native';
import { act, create } from 'react-test-renderer';
import { notifyWorkoutSetLogged } from '../../workout/events';
import { useReminderSync, type ReminderSyncActions } from '../useReminderSync';

jest.mock('../now', () => ({ syncRemindersNow: jest.fn(), cancelRemindersNow: jest.fn() }));

let appStateListener: ((state: string) => void) | null = null;
const remove = jest.fn();

beforeEach(() => {
  appStateListener = null;
  remove.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (state: string) => void) => {
    appStateListener = listener;
    return { remove };
  }) as never);
});
afterEach(() => jest.restoreAllMocks());

const actions = () => ({ sync: jest.fn(async (_userId: string | null) => undefined), cancel: jest.fn(async () => undefined) }) satisfies ReminderSyncActions;

function Probe({ userId, reminders }: { userId: string | null; reminders: ReminderSyncActions }) {
  useReminderSync(userId, reminders);
  return null;
}
const render = async (userId: string | null, reminders: ReminderSyncActions) => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<Probe userId={userId} reminders={reminders} />);
  });
  return tree;
};
const rerender = (tree: ReturnType<typeof create>, userId: string | null, reminders: ReminderSyncActions) =>
  act(async () => {
    tree.update(<Probe userId={userId} reminders={reminders} />);
  });

describe('useReminderSync', () => {
  it('syncs when the app launches with a signed-in account', async () => {
    const r = actions();
    await render('A', r);

    expect(r.sync).toHaveBeenCalledTimes(1);
    expect(r.sync).toHaveBeenCalledWith('A');
  });

  it('syncs again every time the app returns to the foreground, and not when it goes to the background', async () => {
    const r = actions();
    await render('A', r);

    await act(async () => appStateListener!('background'));
    expect(r.sync).toHaveBeenCalledTimes(1);
    await act(async () => appStateListener!('active'));
    expect(r.sync).toHaveBeenCalledTimes(2);
  });

  it('does not sync again on a re-render for the same account', async () => {
    const r = actions();
    const tree = await render('A', r);
    await rerender(tree, 'A', r);

    expect(r.sync).toHaveBeenCalledTimes(1);
  });

  it('cancels the previous accounts reminders before syncing the new account', async () => {
    const r = actions();
    const order: string[] = [];
    r.cancel.mockImplementation(async () => void order.push('cancel'));
    r.sync.mockImplementation(async (id: string | null) => void order.push(`sync ${id}`));
    const tree = await render('A', r);

    await rerender(tree, 'B', r);

    expect(order).toEqual(['sync A', 'cancel', 'sync B']);
  });

  it('cancels everything when the account signs out, and schedules nothing', async () => {
    const r = actions();
    const tree = await render('A', r);

    await rerender(tree, null, r);

    expect(r.cancel).toHaveBeenCalledTimes(1);
    expect(r.sync).toHaveBeenCalledTimes(1);
  });

  it('does nothing while signed out from the start', async () => {
    const r = actions();
    await render(null, r);

    expect(r.sync).not.toHaveBeenCalled();
    appStateListener?.('active');
    expect(r.sync).not.toHaveBeenCalled();
  });

  it('stops listening for foreground changes when it unmounts', async () => {
    const r = actions();
    const tree = await render('A', r);
    await act(async () => tree.unmount());

    expect(remove).toHaveBeenCalled();
  });

  it('survives a failing sync without throwing', async () => {
    const r = actions();
    r.sync.mockRejectedValue(new Error('device refused'));

    await expect(render('A', r)).resolves.toBeDefined();
  });

  it('syncs when the signed-in account logs a set, so completion is re-read from the data, not assumed', async () => {
    const r = actions();
    await render('A', r);

    await act(async () => notifyWorkoutSetLogged('A'));

    expect(r.sync).toHaveBeenCalledTimes(2);
  });

  it('ignores sets logged for another account and stops listening after sign-out', async () => {
    const r = actions();
    const tree = await render('A', r);

    await act(async () => notifyWorkoutSetLogged('B'));
    expect(r.sync).toHaveBeenCalledTimes(1);

    await rerender(tree, null, r);
    await act(async () => notifyWorkoutSetLogged('A'));
    expect(r.sync).toHaveBeenCalledTimes(1);
  });
});
