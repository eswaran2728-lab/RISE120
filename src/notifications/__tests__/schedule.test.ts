import { nextReminder, type ReminderPreferences } from '../schedule';

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
