import { ActiveSession, completedSetCount, nextStep } from '../sessionState';

const active = (over: Partial<ActiveSession> = {}): ActiveSession => ({
  sessionId: 's1',
  templateId: 'home-basics',
  templateVersion: 1,
  dayNumber: 18,
  status: 'active',
  exercises: [
    { exerciseId: 'a', sets: 2, reps: 10 },
    { exerciseId: 'b', sets: 2, reps: 10 },
  ],
  loggedSets: [],
  ...over,
});

describe('nextStep', () => {
  it('offers a choice when there is no session for today', () => {
    expect(nextStep(null, 18)).toEqual({ kind: 'choose' });
  });

  it('resumes the session that is already started: new preferences never replace it', () => {
    const step = nextStep(active({ loggedSets: [{ exerciseId: 'a' }] }), 18);

    expect(step).toMatchObject({ kind: 'resume', sessionId: 's1' });
  });

  it('keeps every logged set when resuming', () => {
    const logged = [{ exerciseId: 'a' }, { exerciseId: 'a' }];

    expect(nextStep(active({ loggedSets: logged }), 18)).toMatchObject({ kind: 'resume', completedSets: 2, plannedSets: 4 });
  });

  it('offers a fresh choice once the session is completed', () => {
    expect(nextStep(active({ status: 'completed' }), 18)).toEqual({ kind: 'done', sessionId: 's1' });
  });

  it('does not carry a session from another day into today', () => {
    expect(nextStep(active({ dayNumber: 17 }), 18)).toEqual({ kind: 'choose' });
  });
});

describe('completedSetCount', () => {
  it('counts only sets of planned exercises, and no more than planned per exercise', () => {
    const session = active({ loggedSets: [{ exerciseId: 'a' }, { exerciseId: 'a' }, { exerciseId: 'a' }, { exerciseId: 'zzz' }, { exerciseId: 'b' }] });

    expect(completedSetCount(session)).toBe(3);
  });
});
