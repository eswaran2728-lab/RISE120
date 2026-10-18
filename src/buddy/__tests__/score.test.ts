import { participationScore, rankMembers } from '../score';

const FROM = '2026-10-12';
const TO = '2026-10-18';
const member = (memberId: string, displayName: string, days: string[]) => ({ memberId, displayName, days });

describe('participationScore', () => {
  it('is one point for each day with a logged workout in the range', () => {
    expect(participationScore(['2026-10-12', '2026-10-15', '2026-10-18'], FROM, TO)).toBe(3);
  });

  it('gives no extra points for more sets, more exercises or a second entry on the same day', () => {
    expect(participationScore(['2026-10-12', '2026-10-12', '2026-10-12'], FROM, TO)).toBe(1);
  });

  it('ignores days outside the range', () => {
    expect(participationScore(['2026-10-11', '2026-10-19', '2026-10-13'], FROM, TO)).toBe(1);
  });

  it('can never exceed the number of days in the range, however many entries there are', () => {
    const lots = Array.from({ length: 200 }, (_, i) => `2026-10-${String(12 + (i % 7)).padStart(2, '0')}`);

    expect(participationScore(lots, FROM, TO)).toBe(7);
  });

  it('ignores anything that is not a date', () => {
    expect(participationScore(['2026-10-13', 'nonsense', '', '2026-13-45'], FROM, TO)).toBe(1);
  });
});

describe('rankMembers', () => {
  it('orders members by points, highest first', () => {
    const ranked = rankMembers([member('a', 'Alex', ['2026-10-12']), member('b', 'Sam', ['2026-10-12', '2026-10-13', '2026-10-14'])], FROM, TO);

    expect(ranked.map((r) => [r.displayName, r.score, r.rank])).toEqual([['Sam', 3, 1], ['Alex', 1, 2]]);
  });

  it('gives tied members the same rank and skips the next one (1, 1, 3)', () => {
    const ranked = rankMembers(
      [member('a', 'Alex', ['2026-10-12']), member('b', 'Sam', ['2026-10-13']), member('c', 'Lee', []), member('d', 'Kim', ['2026-10-14', '2026-10-15', '2026-10-16'])],
      FROM,
      TO
    );

    expect(ranked.map((r) => [r.displayName, r.rank])).toEqual([['Kim', 1], ['Alex', 2], ['Sam', 2], ['Lee', 4]]);
  });

  it('puts tied members in a fixed order (by name) so the list does not shuffle', () => {
    const one = rankMembers([member('b', 'Sam', ['2026-10-12']), member('a', 'Alex', ['2026-10-13'])], FROM, TO);
    const two = rankMembers([member('a', 'Alex', ['2026-10-13']), member('b', 'Sam', ['2026-10-12'])], FROM, TO);

    expect(one.map((r) => r.displayName)).toEqual(['Alex', 'Sam']);
    expect(two).toEqual(one);
  });

  it('is empty for no members, and everyone is rank 1 when nobody logged anything', () => {
    expect(rankMembers([], FROM, TO)).toEqual([]);
    expect(rankMembers([member('a', 'Alex', []), member('b', 'Sam', [])], FROM, TO).map((r) => r.rank)).toEqual([1, 1]);
  });

  it('does not change the members it was given', () => {
    const members = [member('a', 'Alex', ['2026-10-12']), member('b', 'Sam', ['2026-10-12', '2026-10-13'])];
    const copy = JSON.parse(JSON.stringify(members));

    rankMembers(members, FROM, TO);

    expect(members).toEqual(copy);
  });
});
