export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

// Reviewed names in each supported language. Only reviewed aliases are stored; none are invented.
export interface FoodAliases {
  en?: string[];
  ms?: string[];
  ta?: string[];
}

export interface Nutrition {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

// Nutrition values are per listed serving (servingDesc), not per 100 g unless the serving is 100 g.
export interface Food extends Nutrition {
  id: string;
  userId: string | null; // null = shared, a user id = that user's private food
  name: string;
  aliases: FoodAliases;
  servingDesc: string;
  source: string; // 'curated' | 'usda' | 'openfoodfacts' | 'custom'
  verified: boolean; // reserved for reviewed curated Malaysian foods
  region: string | null;
  sourceId: string | null; // stable id in the source database (e.g. USDA FDC id)
  barcode: string | null;
}

// Raw text from a form, before validation.
export interface FoodFields {
  name: string;
  servingDesc: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

export interface TargetsLike {
  calories: number | null;
  proteinG: number | null;
}
