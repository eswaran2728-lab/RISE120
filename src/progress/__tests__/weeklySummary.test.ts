import { SummaryCheckin, SummaryLog, summariseWeek, toCoachFacts } from '../weeklySummary';

const TODAY = '2026-10-18'; // this week: 2026-10-12 to 2026-10-18; the week before: 2026-10-05 to 2026-10-11
const log = (id: string, date: string, exerciseId = 'squat', reps = 10, weightKg = 20): SummaryLog => ({ id, date, exerciseId, reps, weightKg });
const weigh = (date: string, weightKg: number | null): SummaryCheckin => ({ date, weightKg });
const base = { today: TODAY, logs: [] as SummaryLog[], checkins: [] as SummaryCheckin[], pendingOps: 0, showBodyMetrics: true };

describe('participation', () => {
  it('counts days with a logged workout and days with a check-in in the last 7 days, each once', () => {
    const summary = summariseWeek({
      ...base,
      logs: [log('1', '2026-10-12'), log('2', '2026-10-12'), log('3', '2026-10-15')],
      checkins: [weigh('2026-10-13', 70), weigh('2026-10-13', 70), weigh('2026-10-18', null)],
    });

    expect(summary.participation).toEqual({ workoutDays: 2, checkinDays: 2 });
  });

  describe('time boundaries', () => {
    it('includes the first and last day of the window and nothing on either side', () => {
      const summary = summariseWeek({
        ...base,
        logs: [log('a', '2026-10-11'), log('b', '2026-10-12'), log('c', '2026-10-18'), log('d', '2026-10-19')],
      });

      expect(summary.participation.workoutDays).toBe(2); // the 12th and the 18th
      expect(summary.window).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    });

    it('works across a month and a year boundary', () => {
      const summary = summariseWeek({ ...base, today: '2027-01-02', logs: [log('a', '2026-12-27'), log('b', '2026-12-26'), log('c', '2027-01-02')] });

      expect(summary.window).toEqual({ start: '2026-12-27', end: '2027-01-02' });
      expect(summary.participation.workoutDays).toBe(2);
    });
  });

  it('counts a set that appears twice (same id, for example once synced and once waiting) only once', () => {
    const summary = summariseWeek({ ...base, logs: [log('same', '2026-10-12'), log('same', '2026-10-12'), log('same', '2026-10-12')] });

    expect(summary.strength).toEqual([]); // nothing to compare yet
    expect(summary.participation.workoutDays).toBe(1);
    expect(summary.loggedSets).toBe(1);
  });
});

describe('strength compared with the week before', () => {
  const lastWeek = [log('p1', '2026-10-06', 'squat', 10, 20), log('p2', '2026-10-08', 'squat', 8, 22.5)];

  it('compares the top weight of an exercise logged in both weeks', () => {
    const summary = summariseWeek({ ...base, logs: [...lastWeek, log('t1', '2026-10-13', 'squat', 10, 25)] });

    expect(summary.strength).toEqual([expect.objectContaining({ exerciseId: 'squat', topWeightKg: 25, previousTopWeightKg: 22.5, change: 'up' })]);
  });

  it.each([
    ['up', 30],
    ['same', 22.5],
    ['down', 15],
  ])('says %s when the top weight is %s', (change, weight) => {
    const summary = summariseWeek({ ...base, logs: [...lastWeek, log('t1', '2026-10-13', 'squat', 10, weight as number)] });

    expect(summary.strength[0].change).toBe(change);
  });

  it('never compares different exercises with each other (mixed variants)', () => {
    const summary = summariseWeek({ ...base, logs: [log('p1', '2026-10-06', 'goblet-squat', 10, 20), log('t1', '2026-10-13', 'squat', 10, 60)] });

    expect(summary.strength).toEqual([]);
    expect(summary.coverage.notes).toContain('nothing_to_compare');
  });

  it('leaves out an exercise that was not logged in both weeks, and sets with no weight', () => {
    const summary = summariseWeek({
      ...base,
      logs: [...lastWeek, log('t1', '2026-10-13', 'squat', 10, 25), { id: 'bw', date: '2026-10-14', exerciseId: 'pushup', reps: 10 }, { id: 'bw2', date: '2026-10-07', exerciseId: 'pushup', reps: 8 }],
    });

    expect(summary.strength.map((s) => s.exerciseId)).toEqual(['squat']);
  });

  it('says there is no earlier week rather than inventing a comparison', () => {
    const summary = summariseWeek({ ...base, logs: [log('t1', '2026-10-13')] });

    expect(summary.strength).toEqual([]);
    expect(summary.coverage.notes).toContain('no_previous_week');
  });
});

describe('body measurements', () => {
  const weights = [weigh('2026-10-12', 71), weigh('2026-10-18', 70.2), weigh('2026-10-15', 70.6)];

  it('reports the change between the first and last weigh-in of the week', () => {
    expect(summariseWeek({ ...base, checkins: weights }).body).toEqual({ weighIns: 3, changeKg: -0.8 });
  });

  it('is hidden entirely when the member has hidden body metrics', () => {
    expect(summariseWeek({ ...base, checkins: weights, showBodyMetrics: false }).body).toBeNull();
  });

  it('gives no change from a single weigh-in or none (never an implied trend)', () => {
    expect(summariseWeek({ ...base, checkins: [weigh('2026-10-12', 71)] }).body).toEqual({ weighIns: 1, changeKg: null });
    expect(summariseWeek({ ...base, checkins: [] }).body).toEqual({ weighIns: 0, changeKg: null });
  });

  it('ignores check-ins with no weight and weights outside the window', () => {
    const summary = summariseWeek({ ...base, checkins: [weigh('2026-10-12', null), weigh('2026-10-01', 80), weigh('2026-10-18', 70)] });

    expect(summary.body).toEqual({ weighIns: 1, changeKg: null });
  });
});

describe('data coverage', () => {
  it('says nothing was logged, and that this only shows what was logged', () => {
    const summary = summariseWeek(base);

    expect(summary.coverage.notes).toContain('no_logs');
    expect(summary.coverage).toMatchObject({ daysWithAnyLog: 0, daysInWindow: 7 });
  });

  it('counts days with any workout or check-in', () => {
    const summary = summariseWeek({ ...base, logs: [log('1', '2026-10-12')], checkins: [weigh('2026-10-14', 70)] });

    expect(summary.coverage.daysWithAnyLog).toBe(2);
  });

  it('warns that entries still waiting to sync may make the week look emptier than it was', () => {
    const summary = summariseWeek({ ...base, logs: [log('1', '2026-10-12')], pendingOps: 3 });

    expect(summary.coverage).toMatchObject({ pendingSync: 3 });
    expect(summary.coverage.notes).toContain('pending_sync');
  });

  it('has no pending note when everything is synced', () => {
    expect(summariseWeek({ ...base, logs: [log('1', '2026-10-12')] }).coverage.notes).not.toContain('pending_sync');
  });
});

describe('toCoachFacts', () => {
  it('states only what was logged and never says the member did not train or did not eat', () => {
    const quiet = toCoachFacts(summariseWeek(base)).join(' ');

    expect(quiet).toMatch(/no workout logs/i);
    expect(quiet).toMatch(/may be missing|not proof|does not mean/i);
    expect(quiet).not.toMatch(/did not (train|exercise|eat)|skipped|missed|ate nothing|failed/i);
  });

  it('includes participation, a strength comparison and pending sync, in plain statements', () => {
    const facts = toCoachFacts(
      summariseWeek({ ...base, logs: [log('p1', '2026-10-06', 'squat', 10, 20), log('t1', '2026-10-13', 'squat', 10, 25)], checkins: [weigh('2026-10-12', 70)], pendingOps: 2 })
    ).join('\n');

    expect(facts).toMatch(/1 day with a logged workout/);
    expect(facts).toMatch(/squat/);
    expect(facts).toMatch(/2 entries .*waiting to sync/);
  });

  it('leaves out body measurements when they are hidden', () => {
    const facts = toCoachFacts(summariseWeek({ ...base, checkins: [weigh('2026-10-12', 71), weigh('2026-10-18', 70)], showBodyMetrics: false })).join('\n');

    expect(facts).not.toMatch(/weigh|kg/i);
  });

  it('makes no causal claim', () => {
    const facts = toCoachFacts(summariseWeek({ ...base, logs: [log('p1', '2026-10-06', 'squat', 10, 20), log('t1', '2026-10-13', 'squat', 10, 25)], checkins: [weigh('2026-10-12', 71), weigh('2026-10-18', 70)] })).join(' ');

    expect(facts).not.toMatch(/because|caused|due to|thanks to|as a result|so you/i);
  });
});
