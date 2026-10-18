import { mockStore } from '../../sync/testing/storageMock';
import { clearUserCache } from '../../cache/userCache';
import { clearPendingCycle, takePendingCycle } from '../pendingCycle';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

beforeEach(() => mockStore.clear());

// A choice that did not get a clear answer (no connection) keeps its request id, so retrying can never start a
// second cycle: the server answers the same id with the same cycle.
describe('takePendingCycle', () => {
  it('makes a new request id for a new choice and remembers it', async () => {
    const first = await takePendingCycle('A', 'progression');

    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.mode).toBe('progression');
    expect(await takePendingCycle('A', 'progression')).toEqual(first);
  });

  it('keeps the first choice for a retry, even if the member taps the other one: the first request may already have succeeded', async () => {
    const first = await takePendingCycle('A', 'progression');

    const second = await takePendingCycle('A', 'maintenance');

    expect(second).toEqual(first);
  });

  it('is forgotten once the choice has been answered', async () => {
    const first = await takePendingCycle('A', 'progression');
    await clearPendingCycle('A');

    const next = await takePendingCycle('A', 'maintenance');

    expect(next.requestId).not.toBe(first.requestId);
    expect(next.mode).toBe('maintenance');
  });

  it('never shares a request between accounts', async () => {
    const a = await takePendingCycle('A', 'progression');
    const b = await takePendingCycle('B', 'progression');

    expect(b.requestId).not.toBe(a.requestId);
  });

  it('is removed when the account is deleted', async () => {
    const first = await takePendingCycle('A', 'progression');
    await clearUserCache('A');

    expect((await takePendingCycle('A', 'progression')).requestId).not.toBe(first.requestId);
  });
});
