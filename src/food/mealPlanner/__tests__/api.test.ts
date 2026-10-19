import { loadSavedPlan, saveMealPlan } from '../api';
import { supabase } from '../../../lib/supabase';

jest.mock('../../../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() }, from: jest.fn() } }));

const invoke = supabase.functions.invoke as jest.Mock;
const failure = (status: number, body: Record<string, unknown>) => ({ data: null, error: { name: 'FunctionsHttpError', context: { status, json: async () => body } } });
const selections = [{ recipeId: 'bowl', version: 1, servings: 1.5, day: 0, slot: 0 }];
const input = { requestId: 'r1', expectedRevision: 2, selections };

beforeEach(() => {
  invoke.mockReset();
  (supabase.from as jest.Mock).mockReset();
});

describe('saveMealPlan', () => {
  it('sends the request id, the revision it saw and the selections, never an account id', async () => {
    invoke.mockResolvedValue({ data: { status: 'saved', revision: 3, selections }, error: null });

    const result = await saveMealPlan(input);

    expect(invoke).toHaveBeenCalledWith('meal-plan', { method: 'POST', body: { requestId: 'r1', expectedRevision: 2, selections } });
    expect(result).toEqual({ kind: 'saved', revision: 3, repeated: false });
  });

  it('marks the answer to a repeated request', async () => {
    invoke.mockResolvedValue({ data: { status: 'existing', revision: 3, selections }, error: null });

    expect(await saveMealPlan(input)).toEqual({ kind: 'saved', revision: 3, repeated: true });
  });

  it('reports a stale revision with the current one so the screen can reload', async () => {
    invoke.mockResolvedValue(failure(409, { error: 'REVISION_CONFLICT', revision: 5 }));

    expect(await saveMealPlan(input)).toEqual({ kind: 'stale', revision: 5 });
  });

  it.each([
    [402, 'PREMIUM_REQUIRED', 'premium_required'],
    [422, 'RECIPE_UNAVAILABLE', 'recipe_unavailable'],
    [400, 'invalid_request', 'invalid'],
    [500, 'Could not save the meal plan', 'error'],
  ])('maps %s %s to %s', async (status, code, kind) => {
    invoke.mockResolvedValue(failure(status, { error: code }));

    expect(await saveMealPlan(input)).toEqual({ kind });
  });

  it('says offline, so the same request id can be retried, when no answer arrives', async () => {
    invoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError' } });

    expect(await saveMealPlan(input)).toEqual({ kind: 'offline' });
  });

  it('treats a malformed success as an error', async () => {
    invoke.mockResolvedValue({ data: { status: 'saved', revision: 'x' }, error: null });

    expect(await saveMealPlan(input)).toEqual({ kind: 'error' });
  });
});

describe('loadSavedPlan', () => {
  const rows = (data: unknown, error: unknown = null) => (supabase.from as jest.Mock).mockReturnValue({ select: () => ({ maybeSingle: async () => ({ data, error }) }) });

  it('reads the signed-in members own plan and its revision', async () => {
    rows({ revision: 4, selections });

    expect(await loadSavedPlan()).toEqual({ kind: 'plan', revision: 4, selections });
  });

  it('says there is no plan yet, as revision 0, which is what the first save must name', async () => {
    rows(null);

    expect(await loadSavedPlan()).toEqual({ kind: 'none', revision: 0 });
  });

  it('says it could not read, rather than pretending there is no plan, when the read fails or is malformed', async () => {
    rows(null, { message: 'offline' });
    expect(await loadSavedPlan()).toEqual({ kind: 'unreadable' });

    rows({ revision: 'x', selections: 'y' });
    expect(await loadSavedPlan()).toEqual({ kind: 'unreadable' });
  });
});
