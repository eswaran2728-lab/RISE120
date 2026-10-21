import { addDays, buildWindow, localDate, OffsetAt } from '../days';
import { reconcileDays, sleepByDay, stepsByDay, RawSleep } from '../reconcile';
import type { ImportedDay } from '../types';

const MYT: OffsetAt = () => 480;
const UTC: OffsetAt = () => 0;
// New York: clocks go back at 2026-11-01T06:00:00Z, so 1 November is 25 hours long there.
const NEW_YORK: OffsetAt = (ms) => (ms < Date.parse('2026-11-01T06:00:00Z') ? -240 : -300);

const night = (over: Partial<RawSleep> = {}): RawSleep => ({ id: 's1', origin: 'com.watch.app', start: '2026-10-19T15:00:00Z', end: '2026-10-19T22:30:00Z', endOffsetMinutes: null, stages: null, ...over });
const NOW = Date.parse('2026-10-21T04:00:00Z');

describe('local days', () => {
  it('turns an instant into the local calendar date of the phone', () => {
    expect(localDate(Date.parse('2026-10-20T16:30:00Z'), MYT)).toBe('2026-10-21'); // 00:30 the next morning in Malaysia
    expect(localDate(Date.parse('2026-10-20T16:30:00Z'), UTC)).toBe('2026-10-20');
    expect(localDate(Date.parse('2026-10-20T15:59:59Z'), MYT)).toBe('2026-10-20');
  });

  it('adds days to a date without drifting across months or leap days', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('builds a window of whole local days ending today, with the instant each one starts', () => {
    const window = buildWindow('2026-10-21', 3, MYT);

    expect(window.days).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
    expect(window.starts).toEqual(['2026-10-18T16:00:00.000Z', '2026-10-19T16:00:00.000Z', '2026-10-20T16:00:00.000Z']);
    expect(window.end).toBe('2026-10-21T16:00:00.000Z');
  });

  it('handles a day that is 25 hours long when the clocks go back', () => {
    const window = buildWindow('2026-11-02', 3, NEW_YORK);

    expect(window.days).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    expect(window.starts).toEqual(['2026-10-31T04:00:00.000Z', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z']);
  });
});

describe('sleep', () => {
  const window = buildWindow('2026-10-21', 7, MYT);

  it('counts a night under the day the person woke up, by the phone\'s clock', () => {
    // 22:30Z on the 19th is 06:30 on the 20th in Malaysia.
    const result = sleepByDay([night()], window, NOW, MYT);

    expect(result).toEqual({ '2026-10-20': { value: 450, origins: ['com.watch.app'] } });
  });

  it('puts a night that ends just after midnight on the new day, and one that ends just before it on the old day', () => {
    const after = night({ id: 'a', start: '2026-10-19T17:00:00Z', end: '2026-10-19T16:05:00Z' }); // ends before it starts: ignored
    const late = night({ id: 'b', start: '2026-10-19T09:00:00Z', end: '2026-10-19T16:05:00Z' }); // 00:05 on the 20th
    const early = night({ id: 'c', start: '2026-10-18T09:00:00Z', end: '2026-10-18T15:55:00Z' }); // 23:55 on the 18th

    const result = sleepByDay([after, late, early], window, NOW, MYT);

    expect(Object.keys(result).sort()).toEqual(['2026-10-18', '2026-10-20']);
  });

  it('uses the zone the record was made in when it says so, not the phone\'s zone now', () => {
    const abroad = night({ id: 'z', start: '2026-10-19T20:00:00Z', end: '2026-10-20T03:00:00Z', endOffsetMinutes: -300 }); // 22:00 local, still the 19th

    expect(Object.keys(sleepByDay([abroad], window, NOW, MYT))).toEqual(['2026-10-19']);
    expect(Object.keys(sleepByDay([{ ...abroad, endOffsetMinutes: null }], window, NOW, MYT))).toEqual(['2026-10-20']);
  });

  it('does not add up overlapping sleep from two sources: the union of the intervals is counted once', () => {
    const phone = night({ id: 'p', origin: 'com.phone.app', start: '2026-10-19T15:00:00Z', end: '2026-10-19T22:00:00Z' });
    const watch = night({ id: 'w', origin: 'com.watch.app', start: '2026-10-19T15:30:00Z', end: '2026-10-19T22:30:00Z' });

    const result = sleepByDay([phone, watch], window, NOW, MYT);

    expect(result['2026-10-20'].value).toBe(450); // 15:00 to 22:30, not 420 + 420
    expect(result['2026-10-20'].origins).toEqual(['com.phone.app', 'com.watch.app']);
  });

  it('counts the same record only once if it is returned twice', () => {
    expect(sleepByDay([night(), night()], window, NOW, MYT)['2026-10-20'].value).toBe(450);
  });

  it('leaves out time spent awake or out of bed when the record has stages, and uses the whole session when it has none', () => {
    const staged = night({
      stages: [
        { start: '2026-10-19T15:00:00Z', end: '2026-10-19T15:30:00Z', type: 1 }, // awake
        { start: '2026-10-19T15:30:00Z', end: '2026-10-19T19:30:00Z', type: 5 }, // deep
        { start: '2026-10-19T19:30:00Z', end: '2026-10-19T20:00:00Z', type: 3 }, // out of bed
        { start: '2026-10-19T20:00:00Z', end: '2026-10-19T22:30:00Z', type: 4 }, // light
      ],
    });

    expect(sleepByDay([staged], window, NOW, MYT)['2026-10-20'].value).toBe(390);
  });

  it('ignores records with no length, a start after the end, bad dates, the future, or more than a day', () => {
    const bad: RawSleep[] = [
      night({ id: '1', start: '2026-10-19T22:00:00Z', end: '2026-10-19T22:00:00Z' }),
      night({ id: '2', start: 'nonsense', end: '2026-10-19T22:00:00Z' }),
      night({ id: '3', start: '2026-10-21T10:00:00Z', end: '2026-10-21T18:00:00Z' }), // not yet happened
      night({ id: '4', start: '2026-10-17T00:00:00Z', end: '2026-10-19T22:00:00Z' }), // 2.9 days
    ];

    expect(sleepByDay(bad, window, NOW, MYT)).toEqual({});
  });

  it('leaves out nights outside the window', () => {
    const old = night({ start: '2026-09-01T15:00:00Z', end: '2026-09-01T22:30:00Z' });

    expect(sleepByDay([old], window, NOW, MYT)).toEqual({});
  });

  it('never reports more than 24 hours for a day', () => {
    const many = Array.from({ length: 4 }, (_, i) => night({ id: `n${i}`, start: `2026-10-19T${String(i * 5).padStart(2, '0')}:00:00Z`, end: `2026-10-19T${String(i * 5 + 4).padStart(2, '0')}:59:00Z` }));

    for (const day of Object.values(sleepByDay(many, window, NOW, UTC))) expect(day.value).toBeLessThanOrEqual(1440);
  });
});

describe('steps', () => {
  const window = buildWindow('2026-10-21', 3, MYT);

  it('takes each day\'s total as Health Connect worked it out (it already avoids counting the same walk twice from two apps)', () => {
    const result = stepsByDay([{ count: 4000, origins: ['com.phone.app'] }, { count: 8123.4, origins: ['com.watch.app', 'com.phone.app'] }, { count: 0, origins: [] }], window);

    expect(result).toEqual({ '2026-10-19': { value: 4000, origins: ['com.phone.app'] }, '2026-10-20': { value: 8123, origins: ['com.phone.app', 'com.watch.app'] } });
  });

  it('drops days with no number, negative or absurd numbers', () => {
    const result = stepsByDay([{ count: null, origins: [] }, { count: -5, origins: ['a'] }, { count: 9_999_999, origins: ['a'] }], window);

    expect(result).toEqual({});
  });

  it('ignores groups beyond the window', () => {
    expect(Object.keys(stepsByDay(Array.from({ length: 10 }, () => ({ count: 100, origins: ['a'] })), window))).toHaveLength(3);
  });
});

describe('reconcileDays', () => {
  const window = buildWindow('2026-10-21', 3, MYT);
  const day = (value: number, origins = ['a']): ImportedDay => ({ day: '', value, origins, revision: `${value}|${origins.join(',')}` });

  it('adds new days with a revision', () => {
    const result = reconcileDays({}, { '2026-10-20': { value: 100, origins: ['a'] } }, window, '2026-10-21');

    expect(result.next['2026-10-20']).toMatchObject({ day: '2026-10-20', value: 100, origins: ['a'], revision: expect.any(String) });
    expect(result).toMatchObject({ added: 1, updated: 0, removed: 0 });
  });

  it('changes nothing when the same data comes again (no duplicates, no churn)', () => {
    const first = reconcileDays({}, { '2026-10-20': { value: 100, origins: ['a'] } }, window, '2026-10-21');
    const again = reconcileDays(first.next, { '2026-10-20': { value: 100, origins: ['a'] } }, window, '2026-10-21');

    expect(again.next).toEqual(first.next);
    expect(again).toMatchObject({ added: 0, updated: 0, removed: 0 });
  });

  it('updates a day whose source record changed, including a new origin', () => {
    const first = reconcileDays({}, { '2026-10-20': { value: 100, origins: ['a'] } }, window, '2026-10-21');
    const later = reconcileDays(first.next, { '2026-10-20': { value: 150, origins: ['a', 'b'] } }, window, '2026-10-21');

    expect(later.next['2026-10-20']).toMatchObject({ value: 150, origins: ['a', 'b'] });
    expect(later).toMatchObject({ added: 0, updated: 1, removed: 0 });
  });

  it('removes a day inside the window whose source records were deleted', () => {
    const first = reconcileDays({}, { '2026-10-19': { value: 5, origins: ['a'] }, '2026-10-20': { value: 100, origins: ['a'] } }, window, '2026-10-21');
    const later = reconcileDays(first.next, { '2026-10-20': { value: 100, origins: ['a'] } }, window, '2026-10-21');

    expect(Object.keys(later.next)).toEqual(['2026-10-20']);
    expect(later.removed).toBe(1);
  });

  it('keeps a day older than the window, which this read cannot re-check', () => {
    const old = { '2026-09-01': { ...day(7), day: '2026-09-01' } };

    expect(reconcileDays(old, {}, window, '2026-10-21').next['2026-09-01']).toBeDefined();
  });

  it('drops days older than the 120-day journey so the copy stays bounded', () => {
    const ancient = { '2026-01-01': { ...day(7), day: '2026-01-01' } };

    expect(reconcileDays(ancient, {}, window, '2026-10-21').next).toEqual({});
  });

  it('never invents a day outside the window or in the future', () => {
    const result = reconcileDays({}, { '2026-10-25': { value: 1, origins: ['a'] }, '2026-08-01': { value: 1, origins: ['a'] } }, window, '2026-10-21');

    expect(result.next).toEqual({});
  });

  it('does not change the objects it was given', () => {
    const existing = { '2026-10-20': { ...day(1), day: '2026-10-20' } };
    const copy = JSON.parse(JSON.stringify(existing));

    reconcileDays(existing, { '2026-10-20': { value: 2, origins: ['a'] } }, window, '2026-10-21');

    expect(existing).toEqual(copy);
  });
});
