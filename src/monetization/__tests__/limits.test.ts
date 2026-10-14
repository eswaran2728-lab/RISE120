import { supabase } from '../../lib/supabase';
import { readCache, writeCache } from '../../cache/userCache';
import { accessStatus, formatReset, loadLimits, loadLimitsOrCached, lockedPlanDay, parseLimitSnapshot, unlockActions, LimitSnapshot } from '../limits';

jest.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('../../cache/userCache', () => ({ readCache: jest.fn(), writeCache: jest.fn().mockResolvedValue(undefined) }));

const snapshot = (over: Partial<LimitSnapshot> = {}): LimitSnapshot => ({
  tier: 'free',
  quotaDayUtc: '2026-10-14',
  resetsAt: '2026-10-15T00:00:00.000Z',
  planDaysAccessible: 14,
  food: { used: 3, base: 3, bonus: 0, remaining: 0 },
  ai: { used: 0, base: 1, bonus: 0, remaining: 1 },
  adRewards: { used: 0, max: 3, remaining: 3 },
  ...over,
});

describe('parseLimitSnapshot', () => {
  it('accepts the check-limit answer', () => {
    expect(parseLimitSnapshot(snapshot())).toEqual(snapshot());
  });

  it('accepts unlimited premium allowances (null base and remaining)', () => {
    const premium = snapshot({ tier: 'premium', planDaysAccessible: 120, food: { used: 9, base: null, bonus: 0, remaining: null } });

    expect(parseLimitSnapshot(premium)).toEqual(premium);
  });

  it.each([null, 'x', {}, { ...snapshot(), tier: 'gold' }, { ...snapshot(), resetsAt: 'tomorrow' }, { ...snapshot(), planDaysAccessible: '14' }, { ...snapshot(), food: null }, { ...snapshot(), adRewards: {} }])(
    'rejects a malformed answer: %j',
    (value) => {
      expect(parseLimitSnapshot(value)).toBeNull();
    }
  );
});

describe('loadLimits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (writeCache as jest.Mock).mockResolvedValue(undefined);
  });

  it('asks the check-limit function and remembers the answer for this account', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: snapshot(), error: null });

    expect(await loadLimits('A')).toEqual(snapshot());
    expect(supabase.functions.invoke).toHaveBeenCalledWith('check-limit', { method: 'POST', body: {} });
    expect(writeCache).toHaveBeenCalledWith('A', 'limits', snapshot());
  });

  it('throws on a function error or a malformed answer, and caches nothing', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } });
    await expect(loadLimits('A')).rejects.toThrow('Network request failed');

    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({ data: { nope: true }, error: null });
    await expect(loadLimits('A')).rejects.toThrow();
    expect(writeCache).not.toHaveBeenCalled();
  });
});

describe('loadLimitsOrCached', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the fresh answer when the server is reachable', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: snapshot(), error: null });

    expect(await loadLimitsOrCached('A')).toEqual({ snapshot: snapshot(), stale: false });
  });

  it("falls back to this account's last answer, marked stale, when offline", async () => {
    (supabase.functions.invoke as jest.Mock).mockRejectedValue(new Error('offline'));
    (readCache as jest.Mock).mockResolvedValue(snapshot({ food: { used: 1, base: 3, bonus: 0, remaining: 2 } }));

    const result = await loadLimitsOrCached('A');

    expect(readCache).toHaveBeenCalledWith('A', 'limits');
    expect(result).toEqual({ snapshot: snapshot({ food: { used: 1, base: 3, bonus: 0, remaining: 2 } }), stale: true });
  });

  it('returns null when offline with nothing remembered, and ignores a corrupt cache', async () => {
    (supabase.functions.invoke as jest.Mock).mockRejectedValue(new Error('offline'));
    (readCache as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce({ junk: true });

    expect(await loadLimitsOrCached('A')).toBeNull();
    expect(await loadLimitsOrCached('A')).toBeNull();
  });
});

describe('lockedPlanDay', () => {
  const plan = { startDate: '2026-10-01' };

  it('locks the first day past what the server says is accessible, never by a built-in number', () => {
    expect(lockedPlanDay(plan, '2026-10-14', snapshot())).toBeNull(); // day 14
    expect(lockedPlanDay(plan, '2026-10-15', snapshot())).toBe(15);
    expect(lockedPlanDay(plan, '2026-10-15', snapshot({ planDaysAccessible: 20 }))).toBeNull();
    expect(lockedPlanDay(plan, '2026-10-15', snapshot({ planDaysAccessible: 5 }))).toBe(15);
  });

  it('never locks premium, finished plans, future plans, or when the limits are unknown', () => {
    expect(lockedPlanDay(plan, '2026-10-15', snapshot({ tier: 'premium', planDaysAccessible: 120 }))).toBeNull();
    expect(lockedPlanDay(plan, '2027-03-01', snapshot())).toBeNull(); // day > 120 = plan complete
    expect(lockedPlanDay({ startDate: '2026-12-01' }, '2026-10-15', snapshot())).toBeNull();
    expect(lockedPlanDay(plan, '2026-10-15', null)).toBeNull();
  });
});

describe('unlockActions', () => {
  it('offers Subscribe, and Watch ad while the server says ad rewards remain', () => {
    expect(unlockActions(snapshot())).toEqual(['subscribe', 'watch_ad']);
    expect(unlockActions(snapshot({ adRewards: { used: 3, max: 3, remaining: 0 } }))).toEqual(['subscribe']);
  });

  it('offers nothing to premium, and only Subscribe when the limits are unknown', () => {
    expect(unlockActions(snapshot({ tier: 'premium' }))).toEqual([]);
    expect(unlockActions(null)).toEqual(['subscribe']);
  });

  it('offers no ad for a plan-day lock (an ad cannot unlock plan days)', () => {
    expect(unlockActions(snapshot(), 'plan')).toEqual(['subscribe']);
  });
});

describe('formatReset', () => {
  it('shows the server reset instant in local time and in UTC', () => {
    expect(formatReset('2026-10-15T00:00:00.000Z', { timeZone: 'Asia/Kuala_Lumpur', locale: 'en-GB' })).toEqual({ local: '08:00', utc: '00:00' });
    expect(formatReset('2026-10-15T00:00:00.000Z', { timeZone: 'America/New_York', locale: 'en-GB' })).toEqual({ local: '20:00', utc: '00:00' });
  });
});

describe('accessStatus', () => {
  it('confirms premium only from a fresh server answer', () => {
    expect(accessStatus({ snapshot: snapshot({ tier: 'premium' }), stale: false })).toBe('premium');
  });

  it('does not confirm a remembered premium snapshot: it is unverified', () => {
    expect(accessStatus({ snapshot: snapshot({ tier: 'premium' }), stale: true })).toBe('unverified');
  });

  it('treats free answers, fresh or remembered, and no answer as free', () => {
    expect(accessStatus({ snapshot: snapshot(), stale: false })).toBe('free');
    expect(accessStatus({ snapshot: snapshot(), stale: true })).toBe('free');
    expect(accessStatus(null)).toBe('free');
  });
});
