import type { Food, FoodAliases } from './types';

type Row = Record<string, any>;

export const FOOD_COLUMNS =
  'id, user_id, name, aliases, serving_desc, calories, protein_g, carbs_g, fat_g, source, verified, region, source_id, barcode';

const LANGUAGES = ['en', 'ms', 'ta'] as const;

// Only well-formed, reviewed aliases for the supported languages are kept.
function mapAliases(value: unknown): FoodAliases {
  const aliases: FoodAliases = {};
  if (!value || typeof value !== 'object') return aliases;
  for (const language of LANGUAGES) {
    const list = (value as Record<string, unknown>)[language];
    if (Array.isArray(list)) {
      const names = list.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
      if (names.length > 0) aliases[language] = names;
    }
  }
  return aliases;
}

export function mapFoodRow(row: Row): Food {
  return {
    id: row.id,
    userId: row.user_id ?? null,
    name: row.name,
    aliases: mapAliases(row.aliases),
    servingDesc: row.serving_desc,
    calories: Number(row.calories),
    proteinG: Number(row.protein_g),
    carbsG: Number(row.carbs_g),
    fatG: Number(row.fat_g),
    source: row.source,
    verified: Boolean(row.verified),
    region: row.region ?? null,
    sourceId: row.source_id ?? null,
    barcode: row.barcode ?? null,
  };
}
