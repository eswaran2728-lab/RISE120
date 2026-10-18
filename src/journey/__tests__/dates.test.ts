import { dateInZone, isValidTimeZone, journeyDay, msUntilNextDay, regionDefaultZone } from '../dates';
import { localDateString } from '../../lib/dates';

const KL = 'Asia/Kuala_Lumpur'; // UTC+8, no daylight saving
const SG = 'Asia/Singapore';
const NY = 'America/New_York'; // daylight saving

describe('isValidTimeZone', () => {
  it.each([KL, SG, NY, 'UTC', 'Europe/London'])('accepts %s', (zone) => {
    expect(isValidTimeZone(zone)).toBe(true);
  });

  it.each(['', 'Mars/Phobos', 'kuala lumpur', '+08:00', 'Asia/', null, undefined, 42])('rejects %j', (zone) => {
    expect(isValidTimeZone(zone as never)).toBe(false);
  });
});

describe('dateInZone', () => {
  it('gives the calendar date where the member is, not the UTC date', () => {
    const now = new Date('2026-10-17T16:30:00Z'); // 00:30 on 18 October in Kuala Lumpur

    expect(dateInZone(now, KL)).toBe('2026-10-18');
    expect(dateInZone(now, 'UTC')).toBe('2026-10-17');
    expect(dateInZone(now, NY)).toBe('2026-10-17');
  });

  it('Malaysia and Singapore share a day boundary', () => {
    for (const instant of ['2026-10-17T15:59:59Z', '2026-10-17T16:00:00Z']) {
      expect(dateInZone(new Date(instant), KL)).toBe(dateInZone(new Date(instant), SG));
    }
  });

  it('crosses a year boundary at local midnight', () => {
    expect(dateInZone(new Date('2026-12-31T15:59:59Z'), KL)).toBe('2026-12-31');
    expect(dateInZone(new Date('2026-12-31T16:00:00Z'), KL)).toBe('2027-01-01');
  });

  it('follows daylight saving: the same UTC time maps to different local dates either side of the change', () => {
    expect(dateInZone(new Date('2026-03-08T04:59:00Z'), NY)).toBe('2026-03-07'); // 23:59 EST
    expect(dateInZone(new Date('2026-03-08T05:00:00Z'), NY)).toBe('2026-03-08'); // midnight EST
    expect(dateInZone(new Date('2026-11-01T03:59:00Z'), NY)).toBe('2026-10-31'); // 23:59 EDT
    expect(dateInZone(new Date('2026-11-01T04:00:00Z'), NY)).toBe('2026-11-01'); // midnight EDT
  });

  it.each([null, undefined, '', 'Mars/Phobos'])('falls back to the device calendar date when the zone is %j', (zone) => {
    const now = new Date(2026, 9, 13, 23, 59, 59);

    expect(dateInZone(now, zone as never)).toBe(localDateString(now));
  });
});

describe('journeyDay', () => {
  it('counts calendar days from the start date, day 1 being the start date', () => {
    expect(journeyDay('2026-10-01', new Date('2026-10-01T05:00:00Z'), KL)).toBe(1);
    expect(journeyDay('2026-10-01', new Date('2026-10-18T05:00:00Z'), KL)).toBe(18);
  });

  it('changes at the member\'s midnight, not at UTC midnight', () => {
    const now = new Date('2026-10-17T17:00:00Z'); // 01:00 on 18 October in Kuala Lumpur, still 17 October in UTC

    expect(journeyDay('2026-10-01', now, KL)).toBe(18);
    expect(journeyDay('2026-10-01', now, 'UTC')).toBe(17);
  });

  it('is not moved by a daylight saving change inside the journey', () => {
    expect(journeyDay('2026-03-01', new Date('2026-03-10T12:00:00Z'), NY)).toBe(10);
    expect(journeyDay('2026-10-25', new Date('2026-11-03T12:00:00Z'), NY)).toBe(10);
  });

  it('is day 0 or below before the start and 121 or more after day 120, so callers can tell', () => {
    expect(journeyDay('2026-10-10', new Date('2026-10-09T12:00:00Z'), KL)).toBe(0);
    expect(journeyDay('2026-10-01', new Date('2027-02-01T12:00:00Z'), KL)).toBeGreaterThan(120);
  });

  it('uses the device date when the zone is missing or invalid', () => {
    const now = new Date(2026, 9, 18, 12, 0, 0);

    expect(journeyDay('2026-10-01', now, null)).toBe(18);
    expect(journeyDay('2026-10-01', now, 'Mars/Phobos')).toBe(18);
  });

  it('does not depend on the zone the phone happens to be set to when a zone is given (travel)', () => {
    const now = new Date('2026-10-17T17:00:00Z');

    // The same instant gives the same journey day whatever the phone clock says; only the chosen zone matters.
    expect(journeyDay('2026-10-01', now, KL)).toBe(journeyDay('2026-10-01', new Date(now.getTime()), KL));
    expect(journeyDay('2026-10-01', now, KL)).not.toBe(journeyDay('2026-10-01', now, 'America/Los_Angeles'));
  });
});

describe('msUntilNextDay', () => {
  it('counts to the member\'s next midnight', () => {
    expect(msUntilNextDay(new Date('2026-10-17T15:59:30Z'), KL)).toBe(30_000);
    expect(msUntilNextDay(new Date('2026-10-17T16:00:00Z'), KL)).toBe(24 * 3_600_000);
  });

  it('is right on a 23-hour spring-forward day (a plain 24-hour subtraction would wake an hour late)', () => {
    // 06:00 UTC on 8 March is 01:00 EST; local midnight on 9 March (EDT) is 04:00 UTC.
    expect(msUntilNextDay(new Date('2026-03-08T06:00:00Z'), NY)).toBe(22 * 3_600_000);
  });

  it('is right on a 25-hour fall-back day', () => {
    // 04:00 UTC on 1 November is midnight EDT; the next midnight (EST) is 05:00 UTC on 2 November.
    expect(msUntilNextDay(new Date('2026-11-01T04:00:00Z'), NY)).toBe(25 * 3_600_000);
  });

  it('falls back to the device midnight when the zone is missing', () => {
    const now = new Date(2026, 9, 13, 23, 59, 30);

    expect(msUntilNextDay(now, null)).toBe(30_000);
  });
});

describe('regionDefaultZone', () => {
  it('suggests Kuala Lumpur for Malaysia and Singapore for Singapore', () => {
    expect(regionDefaultZone('MY')).toBe(KL);
    expect(regionDefaultZone('SG')).toBe(SG);
  });

  it('suggests nothing for other regions: the member chooses, or the device decides', () => {
    expect(regionDefaultZone('other')).toBeNull();
  });
});
