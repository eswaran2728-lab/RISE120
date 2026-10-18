import { mockStore } from '../../sync/testing/storageMock';
import { clearUserCache } from '../../cache/userCache';
import { loadHideBody, saveHideBody } from '../preferences';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

beforeEach(() => mockStore.clear());

describe('hiding body measurements', () => {
  it('shows them by default', async () => {
    expect(await loadHideBody('A')).toBe(false);
  });

  it('remembers the choice for this account only', async () => {
    await saveHideBody('A', true);

    expect(await loadHideBody('A')).toBe(true);
    expect(await loadHideBody('B')).toBe(false);
  });

  it('can be turned off again', async () => {
    await saveHideBody('A', true);
    await saveHideBody('A', false);

    expect(await loadHideBody('A')).toBe(false);
  });

  it('is removed with the account', async () => {
    await saveHideBody('A', true);
    await clearUserCache('A');

    expect(await loadHideBody('A')).toBe(false);
  });

  it('shows measurements when the stored value is unreadable (never hides by accident, never loses the choice to show)', async () => {
    await saveHideBody('A', 'yes' as never);

    expect(await loadHideBody('A')).toBe(false);
  });
});
