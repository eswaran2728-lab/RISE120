import { nextReminder, reminderDates, type ReminderPreferences } from '../schedule';

const KL = 'Asia/Kuala_Lumpur'; // UTC+8, no daylight saving
const prefs = (over: Partial<ReminderPreferences> = {}): ReminderPreferences => ({
  enabled: true,
  category: 'workout',
  time: '18:00',
  quietStart: null,
  quietEnd: null,
  pausedCategories: [],
  ...over,
});
const at = (iso: string) => new Date(iso);

describe('nextReminder', () => {
  it('picks todays selected local time when it is still ahead', () => {
    // 09:00 in Kuala Lumpur
    expect(nextReminder(prefs(), false, at('2026-10-18T01:00:00Z'), KL)).toEqual(at('2026-10-18T10:00:00Z'));
  });

  it('moves to tomorrow when the time has passed', () => {
    // 19:00 local
    expect(nextReminder(prefs(), false, at('2026-10-18T11:00:00Z'), KL)).toEqual(at('2026-10-19T10:00:00Z'));
  });

  it('moves to tomorrow when todays session is already done', () => {
    expect(nextReminder(prefs(), true, at('2026-10-18T01:00:00Z'), KL)).toEqual(at('2026-10-19T10:00:00Z'));
  });

  it('gives nothing when reminders are off or the category is paused', () => {
    expect(nextReminder(prefs({ enabled: false }), false, at('2026-10-18T01:00:00Z'), KL)).toBeNull();
    expect(nextReminder(prefs({ pausedCategories: ['workout'] }), false, at('2026-10-18T01:00:00Z'), KL)).toBeNull();
    expect(nextReminder(prefs({ pausedCategories: ['checkin'] }), false, at('2026-10-18T01:00:00Z'), KL)).not.toBeNull();
  });

  it('delays a reminder that falls inside quiet hours until they end', () => {
    // quiet 17:00-19:00 same day, reminder 18:00 -> 19:00
    const p = prefs({ quietStart: '17:00', quietEnd: '19:00' });
    expect(nextReminder(p, false, at('2026-10-18T01:00:00Z'), KL)).toEqual(at('2026-10-18T11:00:00Z'));
  });

  it('handles quiet hours that cross midnight', () => {
    // quiet 22:00-07:00, reminder 23:30 -> 07:00 next local day
    const p = prefs({ time: '23:30', quietStart: '22:00', quietEnd: '07:00' });
    expect(nextReminder(p, false, at('2026-10-18T01:00:00Z'), KL)).toEqual(at('2026-10-18T23:00:00Z'));
    // reminder 06:00 inside the same window, now 05:00 local -> 07:00 same day
    const q = prefs({ time: '06:00', quietStart: '22:00', quietEnd: '07:00' });
    expect(nextReminder(q, false, at('2026-10-17T21:00:00Z'), KL)).toEqual(at('2026-10-17T23:00:00Z'));
  });

  it('keeps the selected local time across a daylight-saving change', () => {
    const NY = 'America/New_York';
    // 2026-03-07 20:00 local (EST, UTC-5); next 08:00 is on the 8th, which is EST until 02:00 then EDT
    const p = prefs({ time: '08:00' });
    expect(nextReminder(p, false, at('2026-03-08T01:00:00Z'), NY)).toEqual(at('2026-03-08T12:00:00Z')); // 08:00 EDT = 12:00Z
  });

  it('moves a time that does not exist forward instead of skipping the day', () => {
    const NY = 'America/New_York';
    const p = prefs({ time: '02:30' });
    const result = nextReminder(p, false, at('2026-03-08T04:00:00Z'), NY)!; // 23:00 local on the 7th
    expect(result.getTime()).toBeGreaterThan(at('2026-03-08T04:00:00Z').getTime());
    expect(result.getTime()).toBeLessThanOrEqual(at('2026-03-08T08:00:00Z').getTime());
  });

  it('follows the zone when the person travels', () => {
    const LONDON = 'Europe/London'; // UTC+1 in October before the 25th
    expect(nextReminder(prefs(), false, at('2026-10-18T01:00:00Z'), LONDON)).toEqual(at('2026-10-18T17:00:00Z'));
  });

  it('rejects malformed times by giving nothing', () => {
    expect(nextReminder(prefs({ time: '25:99' }), false, at('2026-10-18T01:00:00Z'), KL)).toBeNull();
    expect(nextReminder(prefs({ quietStart: 'x', quietEnd: '07:00' }), false, at('2026-10-18T01:00:00Z'), KL)).toBeNull();
  });
});

describe('reminderDates', () => {
  it('lists one reminder per local day for the horizon, starting with the next one', () => {
    const dates = reminderDates(prefs(), false, at('2026-10-18T01:00:00Z'), KL, 14);

    expect(dates).toHaveLength(14);
    expect(dates[0]).toEqual(at('2026-10-18T10:00:00Z'));
    expect(dates[13]).toEqual(at('2026-10-31T10:00:00Z'));
    dates.slice(1).forEach((d, i) => expect(d.getTime() - dates[i].getTime()).toBe(24 * 3600 * 1000));
  });

  it('leaves out only todays reminder when todays workout is complete', () => {
    const dates = reminderDates(prefs(), true, at('2026-10-18T01:00:00Z'), KL, 3);

    expect(dates).toEqual([at('2026-10-19T10:00:00Z'), at('2026-10-20T10:00:00Z'), at('2026-10-21T10:00:00Z')]);
  });

  it('starts tomorrow when todays time has passed', () => {
    expect(reminderDates(prefs(), false, at('2026-10-18T11:00:00Z'), KL, 2)).toEqual([at('2026-10-19T10:00:00Z'), at('2026-10-20T10:00:00Z')]);
  });

  it('moves to the next local day at local midnight, not at UTC midnight', () => {
    // 23:59 in Kuala Lumpur on the 18th; a 00:30 reminder is 31 minutes away
    const p = prefs({ time: '00:30' });
    expect(reminderDates(p, false, at('2026-10-18T15:59:00Z'), KL, 2)).toEqual([at('2026-10-18T16:30:00Z'), at('2026-10-19T16:30:00Z')]);
    // 00:31 local: tonights 00:30 has gone, so the next is a day later
    expect(reminderDates(p, false, at('2026-10-18T16:31:00Z'), KL, 1)).toEqual([at('2026-10-19T16:30:00Z')]);
  });

  it('keeps 08:00 local across the daylight-saving change, so the UTC time shifts by an hour', () => {
    const p = prefs({ time: '08:00' });
    const dates = reminderDates(p, false, at('2026-03-07T20:00:00Z'), 'America/New_York', 3);

    expect(dates).toEqual([at('2026-03-08T12:00:00Z'), at('2026-03-09T12:00:00Z'), at('2026-03-10T12:00:00Z')]);
    // the day before the change is still on standard time
    expect(reminderDates(p, false, at('2026-03-07T05:00:00Z'), 'America/New_York', 2)).toEqual([at('2026-03-07T13:00:00Z'), at('2026-03-08T12:00:00Z')]);
  });

  it('applies quiet hours to every day, giving one reminder a day', () => {
    const p = prefs({ time: '23:30', quietStart: '22:00', quietEnd: '07:00' });
    const dates = reminderDates(p, false, at('2026-10-18T01:00:00Z'), KL, 3);

    expect(dates).toEqual([at('2026-10-18T23:00:00Z'), at('2026-10-19T23:00:00Z'), at('2026-10-20T23:00:00Z')]);
  });

  it('gives nothing when off, paused or malformed', () => {
    expect(reminderDates(prefs({ enabled: false }), false, at('2026-10-18T01:00:00Z'), KL, 14)).toEqual([]);
    expect(reminderDates(prefs({ pausedCategories: ['workout'] }), false, at('2026-10-18T01:00:00Z'), KL, 14)).toEqual([]);
    expect(reminderDates(prefs({ time: '99:99' }), false, at('2026-10-18T01:00:00Z'), KL, 14)).toEqual([]);
  });

  it('never returns a time that has already passed', () => {
    const now = at('2026-10-18T10:00:00Z'); // exactly 18:00 local
    reminderDates(prefs(), false, now, KL, 5).forEach((d) => expect(d.getTime()).toBeGreaterThan(now.getTime()));
  });
});

