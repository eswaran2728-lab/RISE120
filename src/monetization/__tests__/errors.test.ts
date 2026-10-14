import { QuotaLimitError, quotaErrorFrom } from '../errors';

describe('quotaErrorFrom', () => {
  it('turns the stable server refusal into a typed pending reason with the server reset time', () => {
    const error = quotaErrorFrom({ message: 'FOOD_LIMIT_REACHED', code: 'P0001', hint: '2026-10-15T00:00:00Z' });

    expect(error).toBeInstanceOf(QuotaLimitError);
    expect(error?.reason).toEqual({ kind: 'limit', limit: 'food', resetsAt: '2026-10-15T00:00:00.000Z' });
  });

  it('keeps the refusal even when the reset time is missing or unreadable', () => {
    expect(quotaErrorFrom({ message: 'FOOD_LIMIT_REACHED' })?.reason.resetsAt).toBeNull();
    expect(quotaErrorFrom({ message: 'FOOD_LIMIT_REACHED', hint: 'soon' })?.reason.resetsAt).toBeNull();
    expect(quotaErrorFrom({ message: 'FOOD_LIMIT_REACHED', hint: null })?.reason.resetsAt).toBeNull();
  });

  it('does not treat other errors as a quota refusal', () => {
    expect(quotaErrorFrom(null)).toBeNull();
    expect(quotaErrorFrom({ message: 'Network request failed' })).toBeNull();
    expect(quotaErrorFrom({ message: 'new row violates row-level security policy' })).toBeNull();
    expect(quotaErrorFrom({ message: 'ACCEPTED_DATE_IMMUTABLE' })).toBeNull();
    expect(quotaErrorFrom({})).toBeNull();
  });
});
