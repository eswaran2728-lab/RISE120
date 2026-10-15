import { describeProposal, retrySecondsLeft, upsertExchange, withProposalStatus } from '../state';
import type { CoachExchange, CoachProposal } from '../types';

const names: Record<string, string> = { sq: 'Barbell squat', lp: 'Leg press', rd: 'Romanian deadlift' };
const ctx = { startDate: '2026-10-16' as string | null, exerciseName: (id: string) => names[id] ?? null };
const workout = (rows: [string, number, number][]) => ({ kind: 'workout' as const, exercises: rows.map(([exercise_id, sets, reps]) => ({ exercise_id, sets, reps })) });

const proposal = (patches: CoachProposal['patches'], status: CoachProposal['status'] = 'pending'): CoachProposal => ({ id: 'p1', status, patches });
const exchange = (requestId: string, over: Partial<CoachExchange> = {}): CoachExchange => ({
  requestId, messageId: `m-${requestId}`, message: 'q', reply: 'a', language: 'en', createdAt: null, proposal: null, ...over,
});

describe('describeProposal', () => {
  it('shows the date of each affected day, from the plan start', () => {
    const view = describeProposal(proposal([{ dayNumber: 5, expected: { workout: { kind: 'rest' }, calorieTarget: 2650, proteinTargetG: 125 }, next: { calorieTarget: 2750 } }]), ctx);

    expect(view[0]).toMatchObject({ dayNumber: 5, date: '2026-10-20' });
  });

  it('falls back to the day number alone when the plan start is unknown', () => {
    const view = describeProposal(proposal([{ dayNumber: 5, expected: { workout: { kind: 'rest' }, calorieTarget: 2650, proteinTargetG: 125 }, next: { calorieTarget: 2750 } }]), { ...ctx, startDate: null });

    expect(view[0].date).toBeNull();
  });

  it('shows exact before and after calories and protein', () => {
    const view = describeProposal(
      proposal([{ dayNumber: 6, expected: { workout: { kind: 'rest' }, calorieTarget: 2650, proteinTargetG: 125 }, next: { calorieTarget: 2550, proteinTargetG: 130 } }]),
      ctx
    );

    expect(view[0].lines).toEqual([
      { kind: 'calories', before: 2650, after: 2550 },
      { kind: 'protein', before: 125, after: 130 },
    ]);
  });

  it('shows only what a patch changes, never an unrelated field', () => {
    const view = describeProposal(proposal([{ dayNumber: 6, expected: { workout: { kind: 'rest' }, calorieTarget: 2650, proteinTargetG: 125 }, next: { proteinTargetG: 130 } }]), ctx);

    expect(view[0].lines.map((l) => l.kind)).toEqual(['protein']);
  });

  it('shows exact before and after sets, reps and exercise for each changed exercise only', () => {
    const view = describeProposal(
      proposal([
        {
          dayNumber: 5,
          expected: { workout: workout([['sq', 2, 10], ['rd', 2, 10]]), calorieTarget: 2650, proteinTargetG: 125 },
          next: { workout: workout([['lp', 3, 12], ['rd', 2, 10]]) },
        },
      ]),
      ctx
    );

    expect(view[0].lines).toEqual([
      { kind: 'workout', rows: [{ position: 1, before: { name: 'Barbell squat', sets: 2, reps: 10 }, after: { name: 'Leg press', sets: 3, reps: 12 } }] },
    ]);
  });

  it('names an exercise it does not know generically, not by id', () => {
    const view = describeProposal(
      proposal([{ dayNumber: 5, expected: { workout: workout([['zz', 2, 10]]), calorieTarget: null, proteinTargetG: null }, next: { workout: workout([['zz', 3, 10]]) } }]),
      ctx
    );

    const row = (view[0].lines[0] as { rows: { before: { name: string | null } }[] }).rows[0];
    expect(row.before.name).toBeNull();
  });

  it('copes with a missing prior calorie or protein value', () => {
    const view = describeProposal(proposal([{ dayNumber: 6, expected: { workout: { kind: 'rest' }, calorieTarget: null, proteinTargetG: null }, next: { calorieTarget: 2000, proteinTargetG: 100 } }]), ctx);

    expect(view[0].lines).toEqual([
      { kind: 'calories', before: null, after: 2000 },
      { kind: 'protein', before: null, after: 100 },
    ]);
  });

  it('lists days in plan order', () => {
    const e = { workout: { kind: 'rest' as const }, calorieTarget: 2650, proteinTargetG: 125 };
    const view = describeProposal(proposal([{ dayNumber: 8, expected: e, next: { calorieTarget: 2700 } }, { dayNumber: 5, expected: e, next: { calorieTarget: 2700 } }]), ctx);

    expect(view.map((d) => d.dayNumber)).toEqual([5, 8]);
  });
});

describe('retrySecondsLeft', () => {
  const now = Date.parse('2026-10-18T10:00:00Z');

  it('counts whole seconds up to the server retry time', () => {
    expect(retrySecondsLeft('2026-10-18T10:00:30Z', now)).toBe(30);
    expect(retrySecondsLeft('2026-10-18T10:00:00.400Z', now)).toBe(1);
  });

  it('is zero once the time has passed, and when there is none', () => {
    expect(retrySecondsLeft('2026-10-18T09:59:00Z', now)).toBe(0);
    expect(retrySecondsLeft(null, now)).toBe(0);
    expect(retrySecondsLeft('garbage', now)).toBe(0);
  });
});

describe('history helpers', () => {
  it('adds a new exchange at the end, and replaces one with the same request id', () => {
    const history = [exchange('r1'), exchange('r2')];

    expect(upsertExchange(history, exchange('r3')).map((e) => e.requestId)).toEqual(['r1', 'r2', 'r3']);
    const replaced = upsertExchange(history, exchange('r2', { reply: 'updated' }));
    expect(replaced.map((e) => e.requestId)).toEqual(['r1', 'r2']);
    expect(replaced[1].reply).toBe('updated');
  });

  it('changes only the status of the named proposal', () => {
    const e = { workout: { kind: 'rest' as const }, calorieTarget: 2650, proteinTargetG: 125 };
    const history = [
      exchange('r1', { proposal: { id: 'p1', status: 'pending', patches: [{ dayNumber: 5, expected: e, next: { calorieTarget: 2700 } }] } }),
      exchange('r2', { proposal: { id: 'p2', status: 'pending', patches: [{ dayNumber: 6, expected: e, next: { calorieTarget: 2700 } }] } }),
    ];

    const next = withProposalStatus(history, 'p2', 'accepted');

    expect(next[0].proposal?.status).toBe('pending');
    expect(next[1].proposal?.status).toBe('accepted');
    expect(history[1].proposal?.status).toBe('pending'); // the original is not mutated
  });
});
