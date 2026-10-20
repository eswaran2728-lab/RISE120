import { analysePhoto, uploadFoodPhoto, removeUploadedFoodPhoto, foodPhotoObjectPath } from '../api';
import { supabase } from '../../../lib/supabase';

const upload = jest.fn();
const remove = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: jest.requireActual('../../../sync/testing/storageMock').asyncStorageMock,
}));
jest.mock('../../../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() }, storage: { from: jest.fn() } } }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({ uri, arrayBuffer: async () => new ArrayBuffer(8) })),
}));

const invoke = supabase.functions.invoke as jest.Mock;
const REQUEST = '7a2b8c1e-1111-4222-8333-444455556667';
const httpError = (status: number, body: unknown) => ({ name: 'FunctionsHttpError', context: { status, json: async () => body } });
const candidate = { kind: 'food', id: '3f2b8c1e-1111-4222-8333-444455556666', name: 'Fixture rice', uncertainty: 'likely', servings: 1, loggable: true, provenance: { source: 'curated', sourceId: 'r', verified: true, reviewed: true } };

beforeEach(() => {
  jest.clearAllMocks();
  (supabase.storage.from as jest.Mock).mockReturnValue({ upload, remove });
});

describe('analysePhoto', () => {
  it('sends only the request id and the private image reference, never an account id or nutrition', async () => {
    invoke.mockResolvedValue({ data: { status: 'ok', candidates: [candidate] }, error: null });

    const result = await analysePhoto('A', REQUEST);

    expect(invoke).toHaveBeenCalledWith('analyse-food-photo', { method: 'POST', body: { requestId: REQUEST, privateImageRef: `A/${REQUEST}.jpg` } });
    expect(result).toEqual({ kind: 'ok', candidates: [expect.objectContaining({ id: candidate.id })] });
  });

  it('reports no match as its own result', async () => {
    invoke.mockResolvedValue({ data: { status: 'no_match', candidates: [] }, error: null });

    expect(await analysePhoto('A', REQUEST)).toEqual({ kind: 'no_match' });
  });

  it('treats an ok answer with nothing usable as no match, rather than an empty list', async () => {
    invoke.mockResolvedValue({ data: { status: 'ok', candidates: [{ kind: 'food' }] }, error: null });

    expect(await analysePhoto('A', REQUEST)).toEqual({ kind: 'no_match' });
  });

  it.each([
    [409, { status: 'in_progress' }, { kind: 'in_progress' }],
    [429, { status: 'limited', retryAt: '2026-10-21T00:00:00.000Z' }, { kind: 'limited', retryAt: '2026-10-21T00:00:00.000Z' }],
    [503, { status: 'unavailable', reason: 'disabled' }, { kind: 'unavailable', reason: 'disabled' }],
    [503, { status: 'unavailable', reason: 'premium_required' }, { kind: 'unavailable', reason: 'premium_required' }],
    [503, { status: 'unavailable', reason: 'surprise' }, { kind: 'unavailable', reason: 'other' }],
    [422, { status: 'invalid_image', reason: 'metadata' }, { kind: 'invalid_image', missing: false }],
    [422, { status: 'invalid_image', reason: 'missing' }, { kind: 'invalid_image', missing: true }],
    [503, { status: 'temporary' }, { kind: 'temporary' }],
    [502, { status: 'failed' }, { kind: 'failed' }],
    [504, { status: 'unknown' }, { kind: 'unknown' }],
    [400, { error: 'invalid_request' }, { kind: 'error' }],
    [500, { error: 'x' }, { kind: 'error' }],
  ])('maps HTTP %s %j to %j', async (status, body, expected) => {
    invoke.mockResolvedValue({ data: null, error: httpError(status, body) });

    expect(await analysePhoto('A', REQUEST)).toEqual(expected);
  });

  it('says offline when the server cannot be reached', async () => {
    invoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError' } });

    expect(await analysePhoto('A', REQUEST)).toEqual({ kind: 'offline' });
  });
});

describe('uploading the private photo', () => {
  it('stores it at the generated name in the food-photos bucket, as a JPEG that cannot overwrite', async () => {
    upload.mockResolvedValue({ error: null });

    const result = await uploadFoodPhoto('A', REQUEST, 'file:///docs/food-photos/A/x.jpg');

    expect(supabase.storage.from).toHaveBeenCalledWith('food-photos');
    expect(upload).toHaveBeenCalledWith(`A/${REQUEST}.jpg`, expect.any(ArrayBuffer), { contentType: 'image/jpeg', upsert: false });
    expect(result).toEqual({ kind: 'ok' });
    expect(foodPhotoObjectPath('A', REQUEST)).toBe(`A/${REQUEST}.jpg`);
  });

  it('treats an object that is already there (a retry) as success', async () => {
    upload.mockResolvedValue({ error: { message: 'The resource already exists', statusCode: '409' } });

    expect(await uploadFoodPhoto('A', REQUEST, 'file:///x.jpg')).toEqual({ kind: 'ok' });
  });

  it('reports offline and other failures separately', async () => {
    upload.mockRejectedValueOnce(new TypeError('Network request failed'));
    upload.mockResolvedValueOnce({ error: { message: 'new row violates row-level security policy', statusCode: '403' } });

    expect(await uploadFoodPhoto('A', REQUEST, 'file:///x.jpg')).toEqual({ kind: 'offline' });
    expect(await uploadFoodPhoto('A', REQUEST, 'file:///x.jpg')).toEqual({ kind: 'error' });
  });

  it('can remove its own uploaded object, and never throws', async () => {
    remove.mockRejectedValue(new Error('offline'));

    await expect(removeUploadedFoodPhoto('A', REQUEST)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith([`A/${REQUEST}.jpg`]);
  });
});
