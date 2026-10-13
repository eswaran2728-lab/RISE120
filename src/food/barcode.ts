import { supabase } from '../lib/supabase';

// Barcode validation: EAN-13, UPC-A (12 digits) and EAN-8, with the GS1 check digit. Kept identical
// to supabase/functions/_shared/food/barcode.ts (a test checks they agree).
export function isValidBarcode(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (code.length !== 8 && code.length !== 12 && code.length !== 13) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop() as number;
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// An Open Food Facts product, shown for information only. It is unverified, carries its source and
// is NOT stored or loggable until the owner approves a compliant reuse approach.
export interface OffPreview {
  source: 'openfoodfacts';
  sourceId: string;
  barcode: string;
  name: string;
  brand?: string;
  servingDesc: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  verified: false;
  sourceUrl: string;
}

export type BarcodeOutcome =
  | { found: false }
  | { found: true; complete: true; product: OffPreview }
  | { found: true; complete: false; name?: string };

export type BarcodeErrorCode = 'invalid' | 'rate_limited' | 'not_configured' | 'unavailable' | 'offline';

export class BarcodeLookupError extends Error {
  constructor(public readonly code: BarcodeErrorCode) {
    super(code);
    this.name = 'BarcodeLookupError';
  }
}

function errorCode(error: { message?: string; context?: { status?: number } }): BarcodeErrorCode {
  const status = error.context?.status;
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'not_configured';
  if (status === undefined) return 'offline'; // the request never got an answer
  return 'unavailable';
}

// Read-only: asks the server about one barcode. Nothing is written to the database or the cache.
export async function lookupBarcode(barcode: string): Promise<BarcodeOutcome> {
  if (!isValidBarcode(barcode)) throw new BarcodeLookupError('invalid');
  const { data, error } = await supabase.functions.invoke('lookup-barcode', { method: 'POST', body: { barcode } });
  if (error) throw new BarcodeLookupError(errorCode(error as { message?: string; context?: { status?: number } }));
  if (!data || typeof data.found !== 'boolean') throw new BarcodeLookupError('unavailable');
  return data as BarcodeOutcome;
}
