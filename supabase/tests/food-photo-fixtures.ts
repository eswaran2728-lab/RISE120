// Synthetic JPEG bytes for the food-photo tests. They have a valid marker structure (so the validator can read the
// size and walk the segments) but no real picture: SYNTHETIC test data only, no real or member photos.
export interface JpegOptions {
  width?: number;
  height?: number;
  exif?: boolean; // an APP1 "Exif" segment (camera and possibly location metadata)
  xmp?: boolean; // an APP1 XMP segment
  iptc?: boolean; // an APP13 segment
  comment?: boolean; // a COM segment
  icc?: boolean; // an APP2 colour profile with a real profile header (allowed)
  iccWithoutSignature?: boolean; // ICC_PROFILE chunk whose payload is not an ICC profile (no 'acsp' signature)
  iccBadChunk?: boolean; // ICC_PROFILE chunk numbered 2 of 1
  iccChunks?: number; // a profile split into this many chunks (valid), to test the size bound
  app2Text?: string; // an APP2 segment that is not a colour profile, carrying this text
  jfifText?: string; // an APP0 segment that is not JFIF, carrying this text
  adobeText?: string; // an APP14 segment that is not Adobe's, carrying this text
  trailing?: number; // this many bytes after the end-of-image marker
  secondImage?: boolean; // a whole second JPEG after the end-of-image marker
  noEoi?: boolean; // truncated: no end-of-image marker
  noSof?: boolean;
  padTo?: number; // grow the entropy data to this many bytes
}

// The start of a real ICC profile: a 128-byte header with the 'acsp' signature at offset 36, then a tag count of zero.
function iccProfile(): number[] {
  const header = new Array(132).fill(0);
  header[3] = 132; // profile size
  header.splice(36, 4, ...[0x61, 0x63, 0x73, 0x70]); // 'acsp'
  return header;
}

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const segment = (marker: number, payload: number[]) => [0xff, marker, ...u16(payload.length + 2), ...payload];
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

export function syntheticJpeg(options: JpegOptions = {}): Uint8Array {
  const { width = 640, height = 480 } = options;
  const bytes: number[] = [0xff, 0xd8]; // SOI
  bytes.push(...segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])); // APP0 JFIF
  if (options.exif) bytes.push(...segment(0xe1, [...ascii('Exif'), 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]));
  if (options.xmp) bytes.push(...segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii('<x:xmpmeta/>')]));
  if (options.iptc) bytes.push(...segment(0xed, [...ascii('Photoshop 3.0'), 0]));
  if (options.icc) bytes.push(...segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, ...iccProfile()]));
  if (options.iccWithoutSignature) bytes.push(...segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, ...new Array(200).fill(7)]));
  if (options.iccBadChunk) bytes.push(...segment(0xe2, [...ascii('ICC_PROFILE'), 0, 2, 1, ...iccProfile()]));
  if (options.iccChunks) {
    for (let i = 1; i <= options.iccChunks; i++) bytes.push(...segment(0xe2, [...ascii('ICC_PROFILE'), 0, i, options.iccChunks, ...(i === 1 ? iccProfile() : new Array(30000).fill(1))]));
  }
  if (options.app2Text !== undefined) bytes.push(...segment(0xe2, ascii(options.app2Text)));
  if (options.jfifText !== undefined) bytes.push(...segment(0xe0, ascii(options.jfifText)));
  if (options.adobeText !== undefined) bytes.push(...segment(0xee, ascii(options.adobeText)));
  if (options.comment) bytes.push(...segment(0xfe, ascii('a comment')));
  bytes.push(...segment(0xdb, [0, ...new Array(64).fill(8)])); // DQT
  if (!options.noSof) bytes.push(...segment(0xc0, [8, ...u16(height), ...u16(width), 1, 1, 0x11, 0])); // SOF0, 1 component
  bytes.push(...segment(0xc4, [0, ...new Array(16).fill(0).map((_, i) => (i === 0 ? 1 : 0)), 0])); // DHT
  bytes.push(...segment(0xda, [1, 1, 0, 0, 63, 0])); // SOS header
  const scan = options.padTo ? Math.max(0, options.padTo - bytes.length - 2) : 16;
  for (let i = 0; i < scan; i++) bytes.push(i % 251 === 0xff ? 0 : i % 251); // entropy-coded data without 0xFF
  if (!options.noEoi) bytes.push(0xff, 0xd9); // EOI
  if (options.trailing) for (let i = 0; i < options.trailing; i++) bytes.push(0x41);
  if (options.secondImage) bytes.push(...syntheticJpeg({ width: 100, height: 100 }));
  return Uint8Array.from(bytes);
}

export const NOT_A_JPEG = Uint8Array.from([...'GIF89a'].map((c) => c.charCodeAt(0)).concat(new Array(64).fill(1)));
export const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(2)]);
