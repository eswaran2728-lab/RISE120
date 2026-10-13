import { mockStore } from '../../sync/testing/storageMock';
import { listPending } from '../../sync/queue';
import { parseCheckinFields, queueCheckin } from '../checkin';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../sync/testing/storageMock').asyncStorageMock,
}));

const valid = { weight: '70,5', sleep: '7,5', mood: 4, units: 'metric' as const };

describe('parseCheckinFields', () => {
  it('parses a decimal-comma weight and sleep', () => {
    expect(parseCheckinFields(valid)).toEqual({ ok: true, weightKg: 70.5, sleepHours: 7.5, mood: 4 });
  });

  it('converts pounds to kilograms rounded to 0.1', () => {
    expect(parseCheckinFields({ ...valid, weight: '155', units: 'imperial' })).toMatchObject({ ok: true, weightKg: 70.3 });
  });

  it.each([
    [{ weight: '', sleep: '7', mood: 3 }, 'weight', 'invalid'],
    [{ weight: 'abc', sleep: '7', mood: 3 }, 'weight', 'invalid'],
    [{ weight: '29', sleep: '7', mood: 3 }, 'weight', 'min'],
    [{ weight: '301', sleep: '7', mood: 3 }, 'weight', 'max'],
    [{ weight: '70', sleep: '', mood: 3 }, 'sleep', 'invalid'],
    [{ weight: '70', sleep: '-1', mood: 3 }, 'sleep', 'invalid'],
    [{ weight: '70', sleep: '25', mood: 3 }, 'sleep', 'max'],
    [{ weight: '70', sleep: '7', mood: null }, 'mood', 'invalid'],
    [{ weight: '70', sleep: '7', mood: 0 }, 'mood', 'invalid'],
    [{ weight: '70', sleep: '7', mood: 6 }, 'mood', 'invalid'],
  ])('rejects %j as %s %s', (fields, field, reason) => {
    expect(parseCheckinFields({ ...fields, units: 'metric' })).toEqual({ ok: false, field, reason });
  });

  it('accepts the weight, sleep and mood bounds', () => {
    expect(parseCheckinFields({ weight: '30', sleep: '0', mood: 1, units: 'metric' }).ok).toBe(true);
    expect(parseCheckinFields({ weight: '300', sleep: '24', mood: 5, units: 'metric' }).ok).toBe(true);
  });
});

describe('queueCheckin', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('queues the check-in for the local date', async () => {
    await queueCheckin('u1', '2026-10-13', valid);

    expect(await listPending('u1')).toEqual([
      expect.objectContaining({ kind: 'checkin', date: '2026-10-13', weightKg: 70.5, sleepHours: 7.5, mood: 4, photoUri: null }),
    ]);
  });

  it('keeps one check-in per date, with the latest edit winning', async () => {
    await queueCheckin('u1', '2026-10-13', valid);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await queueCheckin('u1', '2026-10-13', { ...valid, weight: '71' });

    const pending = await listPending('u1');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ weightKg: 71 });
  });

  it('keeps an offline photo pending with its local file until it uploads', async () => {
    await queueCheckin('u1', '2026-10-13', { ...valid, photoUri: 'file:///docs/photo.jpg' });

    expect((await listPending('u1'))[0]).toMatchObject({ photoUri: 'file:///docs/photo.jpg' });
  });

  it('does not lose a pending photo when the same day is edited without a new photo', async () => {
    await queueCheckin('u1', '2026-10-13', { ...valid, photoUri: 'file:///docs/photo.jpg' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await queueCheckin('u1', '2026-10-13', { ...valid, weight: '71' });

    expect((await listPending('u1'))[0]).toMatchObject({ weightKg: 71, photoUri: 'file:///docs/photo.jpg' });
  });

  it('rejects an invalid check-in and queues nothing', async () => {
    await expect(queueCheckin('u1', '2026-10-13', { ...valid, weight: 'abc' })).rejects.toThrow();

    expect(await listPending('u1')).toEqual([]);
  });

  it('scopes the check-in to the account', async () => {
    await queueCheckin('u1', '2026-10-13', valid);

    expect(await listPending('u2')).toEqual([]);
  });
});
