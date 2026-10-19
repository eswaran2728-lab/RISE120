import { completeSession, loadSessionExercises, swapRemainingExercise } from '../sessionActions';
import { supabase } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() }, rpc: jest.fn() } }));

const invoke = supabase.functions.invoke as jest.Mock;
const rpc = supabase.rpc as jest.Mock;
const failure = (status: number, body: Record<string, unknown>) => ({ data: null, error: { name: 'FunctionsHttpError', context: { status, json: async () => body } } });
const input = { sessionId: 's1', requestId: 'r1', expectedRevision: 0, fromExerciseId: 'squat', replacementId: 'chair' };
const exercises = [{ exerciseId: 'chair', sets: 3, reps: 10, name: { en: 'Chair', ms: 'Kerusi', ta: 'நாற்காலி' }, pattern: 'squat', equipment: 'none' }];

beforeEach(() => jest.resetAllMocks());

describe('swapRemainingExercise', () => {
  it('sends the revision it saw and the exercise ids, never an account id', async () => {
    invoke.mockResolvedValue({ data: { status: 'swapped', revision: 1, exercises }, error: null });

    const result = await swapRemainingExercise(input);

    expect(invoke).toHaveBeenCalledWith('session-actions', { method: 'POST', body: { action: 'swap', sessionId: 's1', requestId: 'r1', expectedRevision: 0, fromExerciseId: 'squat', replacementId: 'chair' } });
    expect(result).toEqual({ kind: 'swapped', revision: 1, exercises: [expect.objectContaining({ exerciseId: 'chair', sets: 3 })], repeated: false });
  });

  it('marks an answer to a repeated request', async () => {
    invoke.mockResolvedValue({ data: { status: 'existing', revision: 1, exercises }, error: null });

    expect(await swapRemainingExercise(input)).toMatchObject({ kind: 'swapped', repeated: true });
  });

  it('reports a stale revision with the current one so the screen can reload', async () => {
    invoke.mockResolvedValue(failure(409, { error: 'REVISION_CONFLICT', revision: 3 }));

    expect(await swapRemainingExercise(input)).toEqual({ kind: 'stale', revision: 3 });
  });

  it.each([
    [409, 'SESSION_COMPLETED', 'session_completed'],
    [404, 'SESSION_NOT_FOUND', 'not_found'],
    [422, 'EQUIPMENT_UNSUITABLE', 'equipment_unsuitable'],
    [422, 'NOT_AN_ALTERNATIVE', 'not_an_alternative'],
    [422, 'ALREADY_IN_SESSION', 'already_in_session'],
    [422, 'REPLACEMENT_UNAVAILABLE', 'replacement_unavailable'],
    [422, 'NOTHING_TO_SWAP', 'nothing_to_swap'],
    [422, 'EXERCISE_NOT_IN_SESSION', 'nothing_to_swap'],
    [500, 'Could not swap the exercise', 'error'],
    [400, 'invalid_request', 'error'],
  ])('maps %s %s to %s', async (status, code, kind) => {
    invoke.mockResolvedValue(failure(status, { error: code }));

    expect(await swapRemainingExercise(input)).toEqual({ kind });
  });

  it('says offline, so the same request id can be retried, when no answer arrives', async () => {
    invoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError' } });

    expect(await swapRemainingExercise(input)).toEqual({ kind: 'offline' });
  });

  it('treats a malformed success as an error rather than trusting it', async () => {
    invoke.mockResolvedValue({ data: { status: 'swapped', revision: 'x', exercises: 'nope' }, error: null });

    expect(await swapRemainingExercise(input)).toEqual({ kind: 'error' });
  });
});

describe('completeSession', () => {
  const summary = { setsCompleted: 2, totalReps: 20, volumeKg: 400, byExercise: [{ exerciseId: 'u', name: 'Squat', sets: 2, reps: 20, volumeKg: 400 }] };

  it('returns the recorded summary and whether this call completed it', async () => {
    invoke.mockResolvedValueOnce({ data: { status: 'completed', summary, completedAt: '2026-10-19T01:00:00Z' }, error: null });
    invoke.mockResolvedValueOnce({ data: { status: 'existing', summary, completedAt: '2026-10-19T01:00:00Z' }, error: null });

    expect(await completeSession('s1')).toEqual({ kind: 'completed', summary, completedAt: '2026-10-19T01:00:00Z', repeated: false });
    expect(await completeSession('s1')).toMatchObject({ kind: 'completed', repeated: true });
    expect(invoke).toHaveBeenCalledWith('session-actions', { method: 'POST', body: { action: 'complete', sessionId: 's1' } });
  });

  it.each([
    [409, 'NOTHING_LOGGED', 'nothing_logged'],
    [404, 'SESSION_NOT_FOUND', 'not_found'],
    [500, 'x', 'error'],
  ])('maps %s %s to %s', async (status, code, kind) => {
    invoke.mockResolvedValue(failure(status, { error: code }));

    expect(await completeSession('s1')).toEqual({ kind });
  });

  it('says offline when no answer arrives', async () => {
    invoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError' } });

    expect(await completeSession('s1')).toEqual({ kind: 'offline' });
  });

  it('refuses a summary it cannot read', async () => {
    invoke.mockResolvedValue({ data: { status: 'completed', summary: { setsCompleted: 'x' }, completedAt: 'x' }, error: null });

    expect(await completeSession('s1')).toEqual({ kind: 'error' });
  });
});

describe('loadSessionExercises', () => {
  it('reads the current list, revision and status of the own session', async () => {
    rpc.mockResolvedValue({ data: { revision: 2, status: 'active', exercises }, error: null });

    expect(await loadSessionExercises('s1')).toEqual({ revision: 2, status: 'active', exercises: [expect.objectContaining({ exerciseId: 'chair' })] });
    expect(rpc).toHaveBeenCalledWith('session_exercises', { p_session_id: 's1' });
  });

  it('gives null for a session that is not the own one, or cannot be read', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    rpc.mockResolvedValueOnce({ data: { revision: 'x' }, error: null });

    expect(await loadSessionExercises('s1')).toBeNull();
    expect(await loadSessionExercises('s1')).toBeNull();
    expect(await loadSessionExercises('s1')).toBeNull();
  });
});
