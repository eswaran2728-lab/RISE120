// Where the member is and how they eat and cook. These are preferences for planning and for the date the
// journey runs on. None of them feeds the calorie or protein targets, which come from body measurements, goal
// and activity only.
export type Region = 'MY' | 'SG' | 'other';
export type CookingAccess = 'full' | 'basic' | 'none';
export type BudgetCurrency = 'MYR' | 'SGD';

export const REGIONS: readonly Region[] = ['MY', 'SG', 'other'];
export const COOKING_ACCESS: readonly CookingAccess[] = ['full', 'basic', 'none'];
export const BUDGET_CURRENCIES: readonly BudgetCurrency[] = ['MYR', 'SGD'];

export const COOKING_MINUTES_RANGE = { min: 5, max: 240 } as const;
export const MAX_BUDGET = 100000;

export interface LifestyleInput {
  region: Region | null;
  journeyTimeZone: string | null; // IANA name such as Asia/Kuala_Lumpur; null means the phone's own zone
  cookingAccess: CookingAccess | null;
  cookingMinutes: number | null;
  budgetAmount: number | null;
  budgetCurrency: BudgetCurrency | null;
}
