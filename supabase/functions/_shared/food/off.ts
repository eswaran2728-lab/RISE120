// Normalizes an Open Food Facts product into an unverified, source-labelled preview. Pure, no I/O.
// Open Food Facts is read-only here: nothing parsed from it is stored (the reuse gate is open).
// A product missing any nutrient, mixing per-100 g and per-serving values, with energy only in kJ,
// or with energy that does not match its macros is reported as incomplete, never as zeros.
import { isEnergyConsistent } from './consistency.ts';

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

export type OffResult =
  | { found: false }
  | { found: true; complete: true; product: OffPreview }
  | { found: true; complete: false; name?: string };

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const round2 = (n: number) => Math.round(n * 100) / 100;

function numeric(nutriments: Json, key: string): number | null {
  const value = nutriments[key];
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

// All four values must come from the same basis (suffix "_100g" or "_serving").
function basis(nutriments: Json, suffix: '_100g' | '_serving') {
  const calories = numeric(nutriments, `energy-kcal${suffix}`);
  const proteinG = numeric(nutriments, `proteins${suffix}`);
  const carbsG = numeric(nutriments, `carbohydrates${suffix}`);
  const fatG = numeric(nutriments, `fat${suffix}`);
  if (calories === null || proteinG === null || carbsG === null || fatG === null) return null;
  return { calories: round2(calories), proteinG: round2(proteinG), carbsG: round2(carbsG), fatG: round2(fatG) };
}

export function parseOffProduct(body: unknown, barcode: string): OffResult {
  if (!isObject(body) || body.status !== 1 || !isObject(body.product)) return { found: false };
  const raw = body.product;

  const name = typeof raw.product_name === 'string' ? raw.product_name.trim() : '';
  const incomplete: OffResult = name === '' ? { found: true, complete: false } : { found: true, complete: false, name };
  if (name === '') return incomplete;

  const nutriments = isObject(raw.nutriments) ? raw.nutriments : {};
  const servingText = typeof raw.serving_size === 'string' ? raw.serving_size.trim() : '';

  // Prefer the per-100 g values (the source data); per-serving only with a stated serving size.
  let servingDesc = '100 g';
  let values = basis(nutriments, '_100g');
  if (!values && servingText !== '') {
    values = basis(nutriments, '_serving');
    servingDesc = servingText;
  }
  if (!values || !isEnergyConsistent(values)) return incomplete;

  const brand = typeof raw.brands === 'string' ? raw.brands.split(',')[0].trim() : '';
  const product: OffPreview = {
    source: 'openfoodfacts',
    sourceId: barcode,
    barcode,
    name,
    servingDesc,
    ...values,
    verified: false,
    sourceUrl: `https://world.openfoodfacts.org/product/${barcode}`,
  };
  if (brand !== '') product.brand = brand;
  return { found: true, complete: true, product };
}
