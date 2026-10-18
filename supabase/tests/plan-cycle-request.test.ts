import { parseCycleRequest, profileForMode } from '../functions/_shared/plan/cycle';
import type { PlanProfile } from '../functions/_shared/plan/types';

const NOW = new Date('2026-10-18T12:00:00Z');
const ID = '3f2b8c1e-1111-4222-8333-444455556666';

describe('parseCycleRequest', () => {
  it('accepts a request id, a mode and a start date near today', () => {
    expect(parseCycleRequest({ requestId: ID, mode: 'progression', startDate: '2026-10-18' }, NOW)).toEqual({ ok: true, requestId: ID, mode: 'progression', startDate: '2026-10-18' });
    expect(parseCycleRequest({ requestId: ID, mode: 'maintenance', startDate: '2026-10-17' }, NOW)).toMatchObject({ ok: true, mode: 'maintenance' });
  });

  it.each([
    ['no request id', { mode: 'progression', startDate: '2026-10-18' }],
    ['a request id that is not a UUID', { requestId: 'abc', mode: 'progression', startDate: '2026-10-18' }],
    ['an unknown mode', { requestId: ID, mode: 'initial', startDate: '2026-10-18' }],
    ['a mode that is not text', { requestId: ID, mode: 1, startDate: '2026-10-18' }],
    ['a start date that is not a date', { requestId: ID, mode: 'progression', startDate: 'tomorrow' }],
    ['an impossible date', { requestId: ID, mode: 'progression', startDate: '2026-02-31' }],
    ['a start date a week away', { requestId: ID, mode: 'progression', startDate: '2026-10-25' }],
    ['a start date a week ago', { requestId: ID, mode: 'progression', startDate: '2026-10-11' }],
    ['no body', null],
    ['a body that is a list', []],
  ])('rejects %s', (_label, body) => {
    expect(parseCycleRequest(body, NOW)).toEqual({ ok: false });
  });

  it('ignores any user id or plan content in the body: only the three fields are read', () => {
    const result = parseCycleRequest({ requestId: ID, mode: 'progression', startDate: '2026-10-18', userId: 'other', days: [1, 2, 3], goal: 'lose_fat' }, NOW);

    expect(result).toEqual({ ok: true, requestId: ID, mode: 'progression', startDate: '2026-10-18' });
  });
});

describe('profileForMode', () => {
  const profile: PlanProfile = {
    age: 30,
    heightCm: 175,
    weightKg: 70,
    goal: 'lose_fat',
    trainingLevel: 'beginner',
    equipment: 'gym',
    energySex: 'male',
    activityLevel: 'light',
  };

  it('keeps the member\'s goal for a progression cycle', () => {
    expect(profileForMode(profile, 'progression')).toEqual(profile);
  });

  it('plans maintenance calories for a maintenance cycle (no deficit or surplus) and changes nothing else', () => {
    const result = profileForMode(profile, 'maintenance');

    expect(result.goal).toBe('recomp');
    expect({ ...result, goal: profile.goal }).toEqual(profile);
  });

  it('does not change the profile it was given', () => {
    const copy = { ...profile };

    profileForMode(profile, 'maintenance');

    expect(profile).toEqual(copy);
  });
});
