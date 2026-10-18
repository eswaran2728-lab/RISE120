import { cycleStage, nextCycleStartDate, participationSummary } from '../completion';

const START = '2026-06-01'; // day 1; day 120 is 2026-09-28; day 121 is 2026-09-29

describe('cycleStage', () => {
  it.each([
    ['2026-05-31', 'not_started'],
    ['2026-06-01', 'running'],
    ['2026-09-27', 'running'], // day 119
    ['2026-09-28', 'last_day'], // day 120
    ['2026-09-29', 'ready_for_review'], // day 121
    ['2027-03-01', 'ready_for_review'],
  ])('on %s the cycle is %s', (today, stage) => {
    expect(cycleStage(START, today)).toBe(stage);
  });
});

describe('nextCycleStartDate', () => {
  it('is today once day 120 has passed', () => {
    expect(nextCycleStartDate(START, '2026-09-29')).toBe('2026-09-29');
    expect(nextCycleStartDate(START, '2026-10-12')).toBe('2026-10-12');
  });

  it('is nothing until then: the last day itself is not the start of the next cycle', () => {
    expect(nextCycleStartDate(START, '2026-09-28')).toBeNull();
    expect(nextCycleStartDate(START, '2026-06-01')).toBeNull();
  });
});

describe('participationSummary', () => {
  const base = { startDate: START, today: '2026-09-29', checkinDates: [] as string[], workoutDates: [] as string[] };

  it('counts days with a check-in and days with a logged workout, each once', () => {
    const summary = participationSummary({
      ...base,
      checkinDates: ['2026-06-01', '2026-06-01', '2026-06-02', '2026-07-01'],
      workoutDates: ['2026-06-03', '2026-06-03', '2026-06-05'],
    });

    expect(summary).toMatchObject({ checkinDays: 3, workoutDays: 2, totalDays: 120 });
  });

  it('ignores anything outside the 120 days of this cycle', () => {
    const summary = participationSummary({ ...base, checkinDates: ['2026-05-31', '2026-09-29', '2026-06-10'], workoutDates: ['2025-01-01', '2026-12-31'] });

    expect(summary).toMatchObject({ checkinDays: 1, workoutDays: 0 });
  });

  it('is zeros, never NaN, when nothing was logged', () => {
    expect(participationSummary(base)).toEqual({ checkinDays: 0, workoutDays: 0, totalDays: 120, daysElapsed: 120 });
  });

  it('counts the days that have passed, up to 120', () => {
    expect(participationSummary({ ...base, today: '2026-06-10' }).daysElapsed).toBe(10);
    expect(participationSummary({ ...base, today: '2027-03-01' }).daysElapsed).toBe(120);
    expect(participationSummary({ ...base, today: '2026-05-01' }).daysElapsed).toBe(0);
  });

  it('only reports counts: no score, rate or verdict a member could feel judged by', () => {
    expect(Object.keys(participationSummary(base)).sort()).toEqual(['checkinDays', 'daysElapsed', 'totalDays', 'workoutDays']);
  });
});
