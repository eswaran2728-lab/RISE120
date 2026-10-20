import { createFoodPhotoDeps } from '../functions/_shared/food/photo/deps';

// Reading the image must tell "it is not there" (cleanup removed it) from "Storage had a hiccup" (try again): the first
// is a known failure about the image, the second must neither delete the image nor end the request.
const dbWith = (download: () => Promise<unknown>) => ({ storage: { from: () => ({ download }) } });
const read = (download: () => Promise<unknown>) => createFoodPhotoDeps(dbWith(download), null).readImage('u/r.jpg');
const blob = (bytes: number[]) => ({ arrayBuffer: async () => Uint8Array.from(bytes).buffer });

describe('readImage', () => {
  it('returns the bytes', async () => {
    expect([...(await read(async () => ({ data: blob([1, 2, 3]), error: null })))!]).toEqual([1, 2, 3]);
  });

  it.each([
    ['a 404 status', { status: 404, message: 'x' }],
    ['a 404 status code', { statusCode: '404', message: 'x' }],
    ['an object-not-found message', { message: 'Object not found' }],
    ['a not_found message', { message: 'not_found' }],
  ])('treats %s as a missing image', async (_name, error) => {
    expect(await read(async () => ({ data: null, error }))).toBeNull();
  });

  it.each([
    ['a 500', { status: 500, message: 'Internal Server Error' }],
    ['a 503', { statusCode: '503', message: 'unavailable' }],
    ['a 429', { status: 429, message: 'slow down' }],
    ['a network message', { message: 'fetch failed' }],
    ['an error with nothing recognisable', {}],
  ])('treats %s as a transient error, which throws', async (_name, error) => {
    await expect(read(async () => ({ data: null, error }))).rejects.toThrow();
  });

  it('throws when the call itself rejects', async () => {
    await expect(read(async () => { throw new TypeError('Network request failed'); })).rejects.toThrow();
  });

  it('throws, rather than reporting a missing image, when there is neither data nor an error', async () => {
    await expect(read(async () => ({ data: null, error: null }))).rejects.toThrow();
  });
});
