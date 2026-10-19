import { parseSummary, summariseSets } from '../summary';

const set = (exerciseId: string, name: string, reps: number, weightKg: number) => ({ exerciseId, name, reps, weightKg });

describe('summariseSets', () => {
  it('counts only what was actually logged, not what was planned', () => {
    const summary = summariseSets([set('a', 'Squat', 10, 20), set('a', 'Squat', 8, 20)]);

    expect(summary).toMatchObject({ setsCompleted: 2, totalReps: 18, volumeKg: 360 });
    expect(summary.byExercise).toEqual([{ exerciseId: 'a', name: 'Squat', sets: 2, reps: 18, volumeKg: 360 }]);
  });

  it('groups by exercise and counts extra sets as done', () => {
    const summary = summariseSets([set('a', 'Squat', 10, 20), set('b', 'Press', 5, 40), set('a', 'Squat', 10, 20), set('a', 'Squat', 10, 20)]);

    expect(summary.setsCompleted).toBe(4);
    expect(summary.byExercise.map((e) => [e.name, e.sets])).toEqual([['Press', 1], ['Squat', 3]]);
  });

  it('is all zeros for no sets', () => {
    expect(summariseSets([])).toEqual({ setsCompleted: 0, totalReps: 0, volumeKg: 0, byExercise: [] });
  });

  it('rounds volume to one decimal so a kilogram figure never shows float noise', () => {
    expect(summariseSets([set('a', 'Squat', 3, 22.7)]).volumeKg).toBe(68.1);
  });
});

describe('parseSummary', () => {
  it('reads a summary from the server', () => {
    const raw = { setsCompleted: 2, totalReps: 20, volumeKg: 400, byExercise: [{ exerciseId: 'u1', name: 'Squat', sets: 2, reps: 20, volumeKg: 400 }], extra: 'ignored' };

    expect(parseSummary(raw)).toEqual({ setsCompleted: 2, totalReps: 20, volumeKg: 400, byExercise: [{ exerciseId: 'u1', name: 'Squat', sets: 2, reps: 20, volumeKg: 400 }] });
  });

  it.each([null, 'x', [], {}, { setsCompleted: '2', totalReps: 1, volumeKg: 1, byExercise: [] }, { setsCompleted: 1, totalReps: 1, volumeKg: 1, byExercise: 'x' }, { setsCompleted: 1, totalReps: 1, volumeKg: 1, byExercise: [{ name: 1 }] }])('rejects %j', (raw) => {
    expect(parseSummary(raw)).toBeNull();
  });
});
