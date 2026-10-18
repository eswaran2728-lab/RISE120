import { startNextCycle } from '../cycles';
import { supabase } from '../../lib/supabase';
import { clearCache } from '../../cache/userCache';
import { getPlanVersion } from '../../plan/planEvents';

jest.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('../../cache/userCache', () => ({ clearCache: jest.fn().mockResolvedValue(undefined) }));

const invoke = supabase.functions.invoke as jest.Mock;
const ID = '3f2b8c1e-1111-4222-8333-444455556666';
const httpError = (status: number, body: unknown) => ({ name: 'FunctionsHttpError', context: { status, json: async () => body } });

beforeEach(() => {
  jest.clearAllMocks();
  (clearCache as jest.Mock).mockResolvedValue(undefined);
});

describe('startNextCycle', () => {
  it('asks the server to start the cycle with the request id, the mode and the date, and nothing else', async () => {
    invoke.mockResolvedValue({ data: { planId: 'p2', created: true, cycleNumber: 2 }, error: null });

    await startNextCycle('A', { requestId: ID, mode: 'progression', startDate: '2026-10-18' });

    expect(invoke).toHaveBeenCalledWith('start-next-cycle', { method: 'POST', body: { requestId: ID, mode: 'progression', startDate: '2026-10-18' } });
  });

  it('on success forgets this account\'s saved plan, so the old cycle is not shown as current, and signals the change', async () => {
    invoke.mockResolvedValue({ data: { planId: 'p2', created: true, cycleNumber: 2 }, error: null });
    const before = getPlanVersion('A');

    const result = await startNextCycle('A', { requestId: ID, mode: 'maintenance', startDate: '2026-10-18' });

    expect(result).toEqual({ kind: 'started', planId: 'p2', cycleNumber: 2, created: true });
    expect(clearCache).toHaveBeenCalledWith('A', 'plan');
    expect(getPlanVersion('A')).toBeGreaterThan(before);
  });

  it('a repeat of the same request answers with the same cycle (created false) and still refreshes the saved plan', async () => {
    invoke.mockResolvedValue({ data: { planId: 'p2', created: false, cycleNumber: 2 }, error: null });

    expect(await startNextCycle('A', { requestId: ID, mode: 'progression', startDate: '2026-10-18' })).toMatchObject({ kind: 'started', created: false });
    expect(clearCache).toHaveBeenCalledWith('A', 'plan');
  });

  it.each([
    [409, { error: 'CYCLE_NOT_FINISHED' }, 'not_finished'],
    [404, { error: 'NO_ACTIVE_PLAN' }, 'no_plan'],
    [400, { error: 'invalid_request' }, 'invalid'],
    [422, { error: 'Profile is incomplete' }, 'profile_incomplete'],
    [500, { error: 'x' }, 'error'],
  ])('maps a %i answer to %s and changes nothing locally', async (status, body, kind) => {
    invoke.mockResolvedValue({ data: null, error: httpError(status, body) });

    expect(await startNextCycle('A', { requestId: ID, mode: 'progression', startDate: '2026-10-18' })).toEqual({ kind });
    expect(clearCache).not.toHaveBeenCalled();
  });

  it('says offline when no answer arrived, so the caller retries with the SAME request id', async () => {
    invoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError' } });

    expect(await startNextCycle('A', { requestId: ID, mode: 'progression', startDate: '2026-10-18' })).toEqual({ kind: 'offline' });
    expect(clearCache).not.toHaveBeenCalled();
  });

  it('treats an answer without a plan id as an error rather than a started cycle', async () => {
    invoke.mockResolvedValue({ data: { created: true }, error: null });

    expect(await startNextCycle('A', { requestId: ID, mode: 'progression', startDate: '2026-10-18' })).toEqual({ kind: 'error' });
  });
});
