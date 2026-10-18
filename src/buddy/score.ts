// A group ranking that rewards turning up, nothing else. A member earns at most one point for each day in the range
// on which they logged a workout, whatever they did that day: more sets, heavier weights, fewer calories or more
// weight lost can never add points. Tied members share a rank (1, 1, 3). Only dates are used, so nothing private
// can enter the score.
import type { MemberDays } from './types';

const isDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
};

export function participationScore(days: string[], from: string, to: string): number {
  return new Set(days.filter((day) => isDate(day) && day >= from && day <= to)).size;
}

export interface RankedMember {
  memberId: string;
  displayName: string;
  score: number;
  rank: number;
}

export function rankMembers(members: MemberDays[], from: string, to: string): RankedMember[] {
  const scored = members
    .map((m) => ({ memberId: m.memberId, displayName: m.displayName, score: participationScore(m.days, from, to) }))
    .sort((a, b) => b.score - a.score || (a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : a.memberId < b.memberId ? -1 : 1));
  return scored.map((m, index) => ({ ...m, rank: index > 0 && scored[index - 1].score === m.score ? 0 : index + 1 })).reduce<RankedMember[]>((out, m) => {
    out.push({ ...m, rank: m.rank === 0 ? out[out.length - 1].rank : m.rank });
    return out;
  }, []);
}
