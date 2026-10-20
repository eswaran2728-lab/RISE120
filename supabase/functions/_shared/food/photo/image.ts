// Server-side look at the bytes of a food photo, before any provider can see it. The MIME type the client claimed is never
// trusted. The check walks the JPEG's marker structure; it does not decode the picture, so a valid result means "a
// well-formed JPEG of a sane declared size with no embedded metadata", not "a picture of food".
//
// Metadata is rejected rather than stripped: the app re-encodes before upload, so an image still carrying EXIF (time,
// camera, possibly location), XMP, IPTC or comments came from somewhere else, and nothing raw is sent upstream.
export const FOOD_PHOTO_LIMITS = {
  maxBytes: 1_500_000,
  maxDimension: 1600,
  minDimension: 64,
} as const;

export type PhotoRejection = 'not_jpeg' | 'malformed' | 'metadata' | 'dimensions' | 'too_large';
export type PhotoInspection = { ok: true; width: number; height: number } | { ok: false; reason: PhotoRejection };

const reject = (reason: PhotoRejection): PhotoInspection => ({ ok: false, reason });

// Segments that carry no personal data: JFIF (APP0), a colour profile (APP2), Adobe colour flags (APP14).
const HARMLESS_APP = new Set([0xe0, 0xe2, 0xee]);

export function inspectFoodPhoto(bytes: Uint8Array): PhotoInspection {
  if (bytes.length > FOOD_PHOTO_LIMITS.maxBytes) return reject('too_large');
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return reject('not_jpeg');

  let offset = 2;
  let size: { width: number; height: number } | null = null;
  let sawScan = false;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return reject('malformed');
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1; // fill bytes
    if (offset >= bytes.length) return reject('malformed');
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9) return sawScan && size ? finish(size) : reject('malformed'); // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // markers without a length

    if (offset + 2 > bytes.length) return reject('malformed');
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return reject('malformed');

    const isApp = marker >= 0xe0 && marker <= 0xef;
    if ((isApp && !HARMLESS_APP.has(marker)) || marker === 0xfe) return reject('metadata');

    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (length < 8) return reject('malformed');
      size = { height: (bytes[offset + 3] << 8) | bytes[offset + 4], width: (bytes[offset + 5] << 8) | bytes[offset + 6] };
    }

    if (marker === 0xda) {
      // Start of scan: the entropy-coded data runs until the next real marker (0xFF followed by neither 0x00 nor RSTn).
      sawScan = true;
      offset += length;
      while (offset + 1 < bytes.length) {
        if (bytes[offset] === 0xff && bytes[offset + 1] !== 0x00 && !(bytes[offset + 1] >= 0xd0 && bytes[offset + 1] <= 0xd7) && bytes[offset + 1] !== 0xff) break;
        offset += 1;
      }
      continue;
    }
    offset += length;
  }
  return reject('malformed'); // ran out of bytes without an end-of-image marker
}

function finish(size: { width: number; height: number }): PhotoInspection {
  const { maxDimension, minDimension } = FOOD_PHOTO_LIMITS;
  const outside = (n: number) => n < minDimension || n > maxDimension;
  return outside(size.width) || outside(size.height) ? reject('dimensions') : { ok: true, ...size };
}
