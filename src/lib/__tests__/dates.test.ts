import { addLocalDays, dayNumberFor, localDateString } from '../dates';

describe('localDateString', () => {
  it('uses the local calendar date, not UTC', () => {
    expect(localDateString(new Date(2026, 9, 13, 23, 59, 59))).toBe('2026-10-13');
    expect(localDateString(new Date(2026, 9, 14, 0, 0, 1))).toBe('2026-10-14');
  });

  it('pads single-digit months and days', () => {
    expect(localDateString(new Date(2027, 0, 5, 12))).toBe('2027-01-05');
  });
});

describe('dayNumberFor', () => {
  it('numbers the start date as day 1', () => {
    expect(dayNumberFor('2026-10-13', '2026-10-13')).toBe(1);
  });

  it('reaches day 120 on the 120th calendar day', () => {
    expect(dayNumberFor('2026-10-13', '2027-02-09')).toBe(120);
    expect(dayNumberFor('2026-10-13', '2027-02-10')).toBe(121);
  });

  it('is not shifted by daylight-saving changes', () => {
    expect(dayNumberFor('2026-03-01', '2026-03-31')).toBe(31);
    expect(dayNumberFor('2026-10-20', '2026-11-05')).toBe(17);
  });

  it('returns zero or below before the start date', () => {
    expect(dayNumberFor('2026-10-13', '2026-10-12')).toBe(0);
  });
});

describe('addLocalDays', () => {
  it('adds and subtracts calendar days across month and year ends', () => {
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2027-03-01', -1)).toBe('2027-02-28');
  });
});
