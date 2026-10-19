// Eating-out guidance for REVIEWED dishes only. A dish carries practical tips and, when a reviewer could support it, an
// approximate calorie RANGE for a described portion, with its source. It is guidance for choosing, not a live menu: it
// never says a restaurant serves the dish, and it never gives a single precise calorie figure, because a portion
// eaten out is uncertain. Unknown calories are null, never zero.
import type { Localised, Provenance } from './recipes';

export type DishStatus = 'draft' | 'in_review' | 'published';

export interface Dish {
  id: string;
  version: number;
  status: DishStatus;
  region: string | null;
  name: Localised;
  aliases: { en?: string[]; ms?: string[]; ta?: string[] };
  tips: Localised[];
  calories: { min: number; max: number } | null; // an approximate range for the portion described in servingNote
  servingNote: Localised | null;
  provenance: Provenance | null;
  reviewer: { name: string; role: string; reviewedOn: string } | null;
}

export type DishErrorCode = 'duplicate_dish' | 'missing_review' | 'missing_name' | 'missing_tips' | 'calories_invalid' | 'calories_not_a_range' | 'calories_need_serving' | 'missing_source';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const complete = (l: Localised | null | undefined) => !!l && filled(l.en) && filled(l.ms) && filled(l.ta);
const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function validateDishes(dishes: Dish[]): { code: DishErrorCode; id: string }[] {
  const errors: { code: DishErrorCode; id: string }[] = [];
  const add = (code: DishErrorCode, id: string) => {
    if (!errors.some((e) => e.code === code && e.id === id)) errors.push({ code, id });
  };
  const seen = new Set<string>();
  for (const d of dishes) {
    const key = `${d.id}|${d.version}`;
    if (seen.has(key)) add('duplicate_dish', d.id);
    seen.add(key);

    if (d.calories) {
      const { min, max } = d.calories;
      if (!isNumber(min) || !isNumber(max) || min < 0) add('calories_invalid', d.id);
      else if (max <= min) add('calories_not_a_range', d.id);
      if (!complete(d.servingNote)) add('calories_need_serving', d.id);
    }

    if (d.status === 'published') {
      const r = d.reviewer;
      if (!r || !filled(r.name) || !filled(r.role) || !DATE.test(r.reviewedOn ?? '')) add('missing_review', d.id);
      if (!complete(d.name)) add('missing_name', d.id);
      if (!Array.isArray(d.tips) || d.tips.length === 0 || !d.tips.every(complete)) add('missing_tips', d.id);
      if (d.calories) {
        const p = d.provenance;
        if (!p || !filled(p.name) || !filled(p.version) || !DATE.test(p.accessedOn ?? '') || !filled(p.licenceEvidence)) add('missing_source', d.id);
      }
    }
  }
  return errors;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isLocalised = (v: unknown): v is Localised => isRecord(v) && typeof v.en === 'string' && typeof v.ms === 'string' && typeof v.ta === 'string';

// Maps one database row to a Dish, or null when it is not the expected shape. Unknown calories stay null.
export function mapDishRow(row: unknown): Dish | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== 'string' || typeof row.version !== 'number' || !['draft', 'in_review', 'published'].includes(row.status as string)) return null;
  if (!isLocalised(row.name) || !Array.isArray(row.tips) || !row.tips.every(isLocalised)) return null;
  const min = isNumber(row.calories_min) ? row.calories_min : typeof row.calories_min === 'string' ? Number(row.calories_min) : null;
  const max = isNumber(row.calories_max) ? row.calories_max : typeof row.calories_max === 'string' ? Number(row.calories_max) : null;
  return {
    id: row.id,
    version: row.version,
    status: row.status as DishStatus,
    region: typeof row.region === 'string' ? row.region : null,
    name: row.name,
    aliases: isRecord(row.aliases) ? (row.aliases as Dish['aliases']) : {},
    tips: row.tips,
    calories: min !== null && max !== null && Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null,
    servingNote: isLocalised(row.serving_note) ? row.serving_note : null,
    provenance: isRecord(row.provenance) ? (row.provenance as unknown as Provenance) : null,
    reviewer: isRecord(row.reviewer) ? (row.reviewer as unknown as NonNullable<Dish['reviewer']>) : null,
  };
}
