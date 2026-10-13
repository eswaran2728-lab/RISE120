export type BodyField = 'age' | 'heightCm' | 'weightKg';

type BodyInput = { age: number; heightCm: number; weightKg: number };
type BodyValidation = { ok: true } | { ok: false; field: BodyField; reason: 'min' | 'max' };

// Phase 1 plan decision: adults only (18-80), height 120-230 cm, weight 30-300 kg.
const BOUNDS: ReadonlyArray<{ field: BodyField; min: number; max: number }> = [
  { field: 'age', min: 18, max: 80 },
  { field: 'heightCm', min: 120, max: 230 },
  { field: 'weightKg', min: 30, max: 300 },
];

export function validateBody(body: BodyInput): BodyValidation {
  for (const { field, min, max } of BOUNDS) {
    if (body[field] < min) return { ok: false, field, reason: 'min' };
    if (body[field] > max) return { ok: false, field, reason: 'max' };
  }
  return { ok: true };
}
