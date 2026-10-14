// Verifies an AdMob rewarded-ad server-side-verification (SSV) callback.
// Google signs the raw query string up to, but not including, "&signature=". The query ends with
// "&signature=<DER ECDSA, base64>&key_id=<id>". The signed bytes must be used exactly as received (original
// order and percent-encoding), so verification works on the raw string and decoding happens afterwards.
export interface KeyLookup {
  // Base64 SPKI public key for a Google key id, or null when Google publishes no such key.
  get(keyId: string): Promise<string | null>;
}

export type VerifyResult =
  | { ok: true; params: Record<string, string> }
  | { ok: false; reason: 'malformed' | 'unknown_key' | 'bad_signature' };

const SIGNATURE_MARK = '&signature=';
const TAIL = /^([^&]+)&key_id=([^&]+)$/;

export async function verifyRewardCallback(rawQuery: string, keys: KeyLookup): Promise<VerifyResult> {
  const query = rawQuery.startsWith('?') ? rawQuery.slice(1) : rawQuery;
  const at = query.lastIndexOf(SIGNATURE_MARK);
  if (at <= 0) return { ok: false, reason: 'malformed' };

  const signedContent = query.slice(0, at);
  const tail = TAIL.exec(query.slice(at + SIGNATURE_MARK.length));
  if (!tail) return { ok: false, reason: 'malformed' };

  // A repeated parameter would make "which value counts" ambiguous, so it is refused outright.
  const params: Record<string, string> = {};
  for (const [name, value] of new URLSearchParams(signedContent)) {
    if (Object.prototype.hasOwnProperty.call(params, name)) return { ok: false, reason: 'malformed' };
    params[name] = value;
  }

  const spki = await keys.get(tail[2]);
  if (spki === null) return { ok: false, reason: 'unknown_key' };

  const signature = derToRaw(base64ToBytes(safeDecode(tail[1])));
  if (!signature) return { ok: false, reason: 'bad_signature' };

  try {
    const key = await crypto.subtle.importKey('spki', base64ToBytes(spki) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature as BufferSource, new TextEncoder().encode(signedContent) as BufferSource);
    return valid ? { ok: true, params } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Accepts standard or URL-safe base64, with or without padding. Returns null bytes on invalid input.
function base64ToBytes(value: string): Uint8Array {
  try {
    const normal = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normal + '='.repeat((4 - (normal.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array(0);
  }
}

// WebCrypto verifies the raw r||s form; Google sends ASN.1 DER. Anything that is not a well-formed
// SEQUENCE of two INTEGERs fitting P-256 is rejected.
function derToRaw(der: Uint8Array): Uint8Array | null {
  let pos = 0;
  const readLength = (): number | null => {
    const first = der[pos++];
    if (first === undefined) return null;
    if (first < 0x80) return first;
    if (first === 0x81) {
      const next = der[pos++];
      return next === undefined ? null : next;
    }
    return null;
  };
  const readInteger = (): Uint8Array | null => {
    if (der[pos++] !== 0x02) return null;
    const length = readLength();
    if (length === null || length === 0 || pos + length > der.length) return null;
    let bytes = der.slice(pos, pos + length);
    pos += length;
    while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.slice(1);
    return bytes.length <= 32 ? bytes : null;
  };

  if (der[pos++] !== 0x30) return null;
  const total = readLength();
  if (total === null || pos + total !== der.length) return null;
  const r = readInteger();
  const s = r && readInteger();
  if (!r || !s || pos !== der.length) return null;

  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
}
