import { mockStore } from '../../sync/testing/storageMock';
import { clearUserCache } from '../../cache/userCache';
import { DEFAULT_REMINDERS, loadReminders, saveReminders } from '../preferences';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

beforeEach(() => mockStore.clear());

describe('reminder preferences', () => {
  it('start switched off, so nothing is ever scheduled before the person opts in', async () => {
    expect(DEFAULT_REMINDERS.enabled).toBe(false);
    expect(await loadReminders('A')).toEqual(DEFAULT_REMINDERS);
  });

  it('are remembered for this account only', async () => {
    const mine = { ...DEFAULT_REMINDERS, enabled: true, time: '06:45', quietStart: '22:00', quietEnd: '07:00' };
    await saveReminders('A', mine);

    expect(await loadReminders('A')).toEqual(mine);
    expect(await loadReminders('B')).toEqual(DEFAULT_REMINDERS);
  });

  it('refuse to save a malformed time and keep the last good value', async () => {
    const good = { ...DEFAULT_REMINDERS, enabled: true, time: '06:45' };
    await saveReminders('A', good);

    expect(await saveReminders('A', { ...good, time: '25:00' })).toBe(false);
    expect(await saveReminders('A', { ...good, quietStart: '22:00', quietEnd: null })).toBe(false);
    expect(await loadReminders('A')).toEqual(good);
  });

  it('fall back to switched off when the stored value is damaged', async () => {
    await saveReminders('A', { ...DEFAULT_REMINDERS, enabled: true });
    mockStore.set('rise120.cache.A.reminders', JSON.stringify({ enabled: true, time: 'soon' }));

    expect(await loadReminders('A')).toEqual(DEFAULT_REMINDERS);
  });

  it('are removed with the account', async () => {
    await saveReminders('A', { ...DEFAULT_REMINDERS, enabled: true });
    await clearUserCache('A');

    expect(await loadReminders('A')).toEqual(DEFAULT_REMINDERS);
  });
});
