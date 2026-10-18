import { startSession } from '../sessions';
import { supabase } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));

const invoke = supabase.functions.invoke as jest.Mock;
const input = { requestId: '3f2b8c1e-1111-4222-8333-444455556666', planId: '9a2b8c1e-1111-4222-8333-444455556666', dayNumber: 18, templateId: 'home-basics', templateVersion: 1 };
const snapshot = {
  templateId: 'home-basics',
  version: 1,
  minutes: 20,
  exercises: [{ exerciseId: 'a', sets: 2, reps: 10, name: { en: 'A', ms: 'A', ta: 'A' }, pattern: 'squat', equipment: 'none' }],
};
const httpError = (status: number, body: unknown) => ({ name: 'FunctionsHttpError', context: { status, json: async () => body } });

beforeEach(() => jest.clearAllMocks());

describe('startSession', () => {
  it('sends the five fields and reads the stored session back', async () => {
    invoke.mockResolvedValue({ data: { sessionId: 's1', status: 'created', snapshot }, error: null });

    const result = await startSession(input);

    expect(invoke).toHaveBeenCalledWith('start-session', { method: 'POST', body: input });
    expect(result).toEqual({ kind: 'started', sessionId: 's1', resumed: false, snapshot });
  });

  it.each([
    ['existing', true],
    ['resumed', true],
    ['created', false],
  ])('treats %s as resumed=%s', async (status, resumed) => {
    invoke.mockResolvedValue({ data: { sessionId: 's1', status, snapshot }, error: null });

    expect(await startSession(input)).toMatchObject({ kind: 'started', resumed });
  });

  it.each([
    [404, { error: 'TEMPLATE_UNAVAILABLE' }, 'template_unavailable'],
    [404, { error: 'PLAN_NOT_FOUND' }, 'plan_not_found'],
    [409, { error: 'DAY_NOT_AVAILABLE' }, 'day_not_available'],
    [400, { error: 'invalid_request' }, 'invalid'],
    [500, { error: 'x' }, 'error'],
  ])('maps %i %j to %s', async (status, body, kind) => {
    invoke.mockResolvedValue({ data: null, error: httpError(status, body) });

    expect(await startSession(input)).toEqual({ kind });
  });

  it('says offline when no answer arrived so the caller retries with the SAME request id', async () => {
    invoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError' } });

    expect(await startSession(input)).toEqual({ kind: 'offline' });
  });

  it('treats an answer without a session id or snapshot as an error', async () => {
    invoke.mockResolvedValue({ data: { status: 'created' }, error: null });

    expect(await startSession(input)).toEqual({ kind: 'error' });
  });
});
