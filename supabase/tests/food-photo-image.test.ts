import { FOOD_PHOTO_LIMITS, inspectFoodPhoto } from '../functions/_shared/food/photo/image';
import { NOT_A_JPEG, PNG_SIGNATURE, syntheticJpeg } from './food-photo-fixtures';

// The server looks at the bytes, never at the MIME type the client claimed, before any provider can see an image.
describe('inspectFoodPhoto', () => {
  it('accepts a plain JPEG and reports its size', () => {
    expect(inspectFoodPhoto(syntheticJpeg({ width: 640, height: 480 }))).toEqual({ ok: true, width: 640, height: 480 });
  });

  it('accepts a colour profile, which carries no personal data', () => {
    expect(inspectFoodPhoto(syntheticJpeg({ icc: true })).ok).toBe(true);
  });

  it.each([
    ['a GIF', NOT_A_JPEG],
    ['a PNG', PNG_SIGNATURE],
    ['text', new TextEncoder().encode('hello, this is not an image at all')],
    ['an empty file', new Uint8Array(0)],
    ['a single byte', Uint8Array.from([0xff])],
  ])('rejects %s even if the client said image/jpeg', (_name, bytes) => {
    expect(inspectFoodPhoto(bytes)).toEqual({ ok: false, reason: 'not_jpeg' });
  });

  it.each([
    ['a file cut off before the end', syntheticJpeg({ noEoi: true })],
    ['a file with no frame header', syntheticJpeg({ noSof: true })],
    ['a file truncated in the middle of a segment', syntheticJpeg().slice(0, 30)],
  ])('rejects %s as malformed', (_name, bytes) => {
    expect(inspectFoodPhoto(bytes)).toEqual({ ok: false, reason: 'malformed' });
  });

  it.each([
    ['EXIF (camera, time and possibly location)', { exif: true }],
    ['XMP', { xmp: true }],
    ['IPTC', { iptc: true }],
    ['a comment', { comment: true }],
  ])('rejects an image carrying %s, so the client has to strip it and nothing raw goes upstream', (_name, options) => {
    expect(inspectFoodPhoto(syntheticJpeg(options))).toEqual({ ok: false, reason: 'metadata' });
  });

  it('rejects dimensions beyond the bound, or too small to be a meal', () => {
    const max = FOOD_PHOTO_LIMITS.maxDimension;
    expect(inspectFoodPhoto(syntheticJpeg({ width: max + 1, height: 480 }))).toEqual({ ok: false, reason: 'dimensions' });
    expect(inspectFoodPhoto(syntheticJpeg({ width: 640, height: max + 1 }))).toEqual({ ok: false, reason: 'dimensions' });
    expect(inspectFoodPhoto(syntheticJpeg({ width: 8, height: 8 }))).toEqual({ ok: false, reason: 'dimensions' });
    expect(inspectFoodPhoto(syntheticJpeg({ width: max, height: max })).ok).toBe(true);
  });

  it('rejects a file over the size limit', () => {
    expect(inspectFoodPhoto(syntheticJpeg({ padTo: FOOD_PHOTO_LIMITS.maxBytes + 10 }))).toEqual({ ok: false, reason: 'too_large' });
    expect(inspectFoodPhoto(syntheticJpeg({ padTo: FOOD_PHOTO_LIMITS.maxBytes - 100 })).ok).toBe(true);
  });

  it('never throws on arbitrary bytes', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const bytes = Uint8Array.from({ length: 40 + (seed % 90) }, (_, i) => (i * seed * 31 + 7) & 0xff);
      bytes[0] = 0xff;
      bytes[1] = 0xd8;
      expect(() => inspectFoodPhoto(bytes)).not.toThrow();
    }
  });
});
