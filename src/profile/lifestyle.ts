import { isValidTimeZone } from '../journey/dates';
import {
  BUDGET_CURRENCIES,
  BudgetCurrency,
  COOKING_ACCESS,
  COOKING_MINUTES_RANGE,
  CookingAccess,
  LifestyleInput,
  MAX_BUDGET,
  REGIONS,
  Region,
} from '../journey/types';
import { supabase } from '../lib/supabase';

export type { LifestyleInput } from '../journey/types';

const EMPTY: LifestyleInput = { region: null, journeyTimeZone: null, cookingAccess: null, cookingMinutes: null, budgetAmount: null, budgetCurrency: null };

export type LifestyleResult = { ok: true; value: LifestyleInput } | { ok: false; field: keyof LifestyleInput | 'input' };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const unset = (value: unknown) => value === null || value === undefined;

// Checks every preference. Only the six known fields are read, so nothing else can be passed on by accident
// (in particular no body measurement or calorie input). Nothing here is required.
export function validateLifestyle(input: unknown): LifestyleResult {
  if (!isRecord(input)) return { ok: false, field: 'input' };

  if (!unset(input.region) && !REGIONS.includes(input.region as Region)) return { ok: false, field: 'region' };
  if (!unset(input.journeyTimeZone) && !isValidTimeZone(input.journeyTimeZone)) return { ok: false, field: 'journeyTimeZone' };
  if (!unset(input.cookingAccess) && !COOKING_ACCESS.includes(input.cookingAccess as CookingAccess)) return { ok: false, field: 'cookingAccess' };
  if (!unset(input.cookingMinutes)) {
    const minutes = input.cookingMinutes;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < COOKING_MINUTES_RANGE.min || minutes > COOKING_MINUTES_RANGE.max) {
      return { ok: false, field: 'cookingMinutes' };
    }
  }
  if (!unset(input.budgetAmount)) {
    const amount = input.budgetAmount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > MAX_BUDGET) return { ok: false, field: 'budgetAmount' };
  }
  if (!unset(input.budgetCurrency) && !BUDGET_CURRENCIES.includes(input.budgetCurrency as BudgetCurrency)) return { ok: false, field: 'budgetCurrency' };
  // A budget needs its currency and a currency needs its budget.
  if (!unset(input.budgetAmount) && unset(input.budgetCurrency)) return { ok: false, field: 'budgetCurrency' };
  if (unset(input.budgetAmount) && !unset(input.budgetCurrency)) return { ok: false, field: 'budgetAmount' };

  return {
    ok: true,
    value: {
      region: (input.region as Region) ?? null,
      journeyTimeZone: (input.journeyTimeZone as string) ?? null,
      cookingAccess: (input.cookingAccess as CookingAccess) ?? null,
      cookingMinutes: (input.cookingMinutes as number) ?? null,
      budgetAmount: (input.budgetAmount as number) ?? null,
      budgetCurrency: (input.budgetCurrency as BudgetCurrency) ?? null,
    },
  };
}

// Saves only the lifestyle columns of the signed-in account's own profile (row-level security also enforces the
// owner). Calorie and protein targets never read these columns.
export async function saveLifestyle(userId: string, input: LifestyleInput): Promise<void> {
  const result = validateLifestyle(input);
  if (!result.ok) throw new Error(`invalid lifestyle: ${result.field}`);
  const v = result.value;
  const { error } = await supabase
    .from('profiles')
    .update({
      region: v.region,
      journey_time_zone: v.journeyTimeZone,
      cooking_access: v.cookingAccess,
      cooking_minutes: v.cookingMinutes,
      budget_amount: v.budgetAmount,
      budget_currency: v.budgetCurrency,
    })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

// A stored value that no longer passes validation is treated as unset, field by field, never trusted.
export async function loadLifestyle(userId: string): Promise<LifestyleInput> {
  const { data, error } = await supabase
    .from('profiles')
    .select('region, journey_time_zone, cooking_access, cooking_minutes, budget_amount, budget_currency')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return { ...EMPTY };

  const keep = (partial: Partial<LifestyleInput>): Partial<LifestyleInput> => {
    const result = validateLifestyle({ ...EMPTY, ...partial });
    return result.ok ? partial : {};
  };
  const amount = data.budget_amount === null || data.budget_amount === undefined ? null : Number(data.budget_amount);
  return {
    ...EMPTY,
    ...keep({ region: data.region }),
    ...keep({ journeyTimeZone: data.journey_time_zone }),
    ...keep({ cookingAccess: data.cooking_access }),
    ...keep({ cookingMinutes: data.cooking_minutes }),
    ...keep({ budgetAmount: amount, budgetCurrency: data.budget_currency }),
  };
}
