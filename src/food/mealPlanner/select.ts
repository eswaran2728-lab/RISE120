// Chooses meals from REVIEWED recipes only. Pure and deterministic: the same inputs give the same plan whatever order
// the recipes arrive in. It uses no AI: calories and protein come from the recipes' own sourced values. Every place the
// result cannot honour a wish (no targets, unknown prices, no matching recipe, an over-budget day) is reported as a
// limitation instead of being hidden, and nothing is invented to fill a gap.
import { scaleRecipe, type Cooking, type DietLabel, type FreeFrom, type Recipe } from '../recipes';
import type { PerServing } from '../portions';

export interface Preferences {
  cooking: Cooking[]; // equipment the member has; empty means no cooker
  maxMinutes: number | null; // longest preparation plus cooking time per meal
  diets: DietLabel[];
  avoid: FreeFrom[]; // allergens to avoid: only recipes that claim to be free of them
  budget: { amount: number; currency: string; per: 'day' } | null;
  mealsPerDay: number; // 1 to 6
  days: number; // 1 to 7
}

export interface Targets {
  calories: number | null;
  proteinG: number | null;
}

export type LimitationCode = 'no_matching_recipes' | 'no_targets' | 'nutrition_incomplete' | 'protein_short' | 'calories_off' | 'budget_unknown' | 'budget_currency_mismatch' | 'over_budget';

export interface Limitation {
  code: LimitationCode;
  detail?: string;
}

export interface PlannedMeal {
  slot: number;
  recipeId: string;
  version: number;
  servings: number;
  nutrition: PerServing | null;
  price: { amount: number; currency: string } | null;
}

export interface PlannedDay {
  day: number;
  meals: PlannedMeal[];
  calories: number | null; // null when any meal's value is unknown
  proteinG: number | null;
  price: number | null; // null when any meal's price is unknown or the currencies differ
}

export interface MealPlan {
  days: PlannedDay[];
  limitations: Limitation[];
  excluded: Record<string, number>; // recipes left out, by the first reason that applied
  budget: { status: 'none' | 'unknown' | 'within' | 'over'; total: number | null; limit: number | null; currency: string | null };
}

const SERVING_CHOICES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const OFF_TARGET = 0.15; // a day more than this far from the calorie target is reported
const PROTEIN_SHORT = 0.85;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function exclusionReason(recipe: Recipe, prefs: Preferences, targets: Targets): string | null {
  if (recipe.status !== 'published' || recipe.userId !== null) return 'unreviewed';
  if (recipe.cooking.some((c) => c !== 'none' && !prefs.cooking.includes(c))) return 'equipment';
  if (prefs.maxMinutes !== null) {
    if (recipe.prepMinutes === null || recipe.cookMinutes === null) return 'time_unknown';
    if (recipe.prepMinutes + recipe.cookMinutes > prefs.maxMinutes) return 'too_long';
  }
  const satisfies = (diet: DietLabel) => recipe.dietLabels.includes(diet) || (diet === 'vegetarian' && recipe.dietLabels.includes('vegan'));
  if (!prefs.diets.every(satisfies)) return 'diet';
  if (!prefs.avoid.every((a) => recipe.freeFrom.includes(a))) return 'allergen';
  if (targets.calories !== null && recipe.nutrition?.perServing.calories == null) return 'nutrition_unknown';
  return null;
}

function bestServings(recipe: Recipe, slotCalories: number | null): number {
  const calories = recipe.nutrition?.perServing.calories;
  if (slotCalories === null || calories === null || calories === undefined) return 1;
  let best = SERVING_CHOICES[0];
  let bestError = Infinity;
  for (const s of SERVING_CHOICES) {
    const error = Math.abs(calories * s - slotCalories);
    if (error < bestError) {
      best = s;
      bestError = error;
    }
  }
  return best;
}

export function selectMeals(prefs: Preferences, recipes: Recipe[], targets: Targets): MealPlan {
  if (!Number.isInteger(prefs.days) || prefs.days < 1 || prefs.days > 7) throw new Error('Plan days must be a whole number from 1 to 7');
  if (!Number.isInteger(prefs.mealsPerDay) || prefs.mealsPerDay < 1 || prefs.mealsPerDay > 6) throw new Error('Meals per day must be a whole number from 1 to 6');

  const excluded: Record<string, number> = {};
  const eligible: Recipe[] = [];
  for (const recipe of [...recipes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.version - b.version))) {
    const reason = exclusionReason(recipe, prefs, targets);
    if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
    else eligible.push(recipe);
  }

  const limitations: Limitation[] = [];
  if (eligible.length === 0) {
    limitations.push({ code: 'no_matching_recipes' });
    return { days: [], limitations, excluded, budget: { status: 'none', total: null, limit: null, currency: null } };
  }
  if (targets.calories === null) limitations.push({ code: 'no_targets' });

  const slotCalories = targets.calories === null ? null : targets.calories / prefs.mealsPerDay;
  const totalUses = new Map<Recipe, number>();
  const days: PlannedDay[] = [];

  for (let day = 0; day < prefs.days; day++) {
    const usedToday = new Map<Recipe, number>();
    const meals: PlannedMeal[] = [];
    for (let slot = 0; slot < prefs.mealsPerDay; slot++) {
      let best: { recipe: Recipe; servings: number; key: number[] } | null = null;
      for (const recipe of eligible) {
        const servings = bestServings(recipe, slotCalories);
        const calories = recipe.nutrition?.perServing.calories;
        const error = slotCalories === null || calories === null || calories === undefined ? 0 : Math.abs(calories * servings - slotCalories);
        const far = slotCalories !== null && error > 0.25 * slotCalories ? 1 : 0;
        const key = [far, usedToday.get(recipe) ?? 0, totalUses.get(recipe) ?? 0, error];
        const better = !best || key.some((k, i) => (k !== best!.key[i] ? k < best!.key[i] : false) && key.slice(0, i).every((v, j) => v === best!.key[j]));
        if (better) best = { recipe, servings, key };
      }
      const chosen = best!;
      usedToday.set(chosen.recipe, (usedToday.get(chosen.recipe) ?? 0) + 1);
      totalUses.set(chosen.recipe, (totalUses.get(chosen.recipe) ?? 0) + 1);
      const scaled = scaleRecipe(chosen.recipe, chosen.servings);
      meals.push({ slot, recipeId: chosen.recipe.id, version: chosen.recipe.version, servings: chosen.servings, nutrition: scaled.nutrition, price: scaled.price });
    }

    const sum = (pick: (m: PlannedMeal) => number | null | undefined) => (meals.some((m) => pick(m) == null) ? null : round2(meals.reduce((t, m) => t + (pick(m) as number), 0)));
    const currencies = new Set(meals.map((m) => m.price?.currency));
    days.push({
      day,
      meals,
      calories: sum((m) => m.nutrition?.calories),
      proteinG: sum((m) => m.nutrition?.proteinG),
      price: currencies.size === 1 ? sum((m) => m.price?.amount) : null,
    });
  }

  // Say where the plan falls short of the targets.
  if (targets.calories !== null && days.some((d) => d.calories !== null && Math.abs(d.calories - targets.calories!) / targets.calories! > OFF_TARGET)) limitations.push({ code: 'calories_off' });
  if (targets.proteinG !== null) {
    if (days.some((d) => d.proteinG === null)) limitations.push({ code: 'nutrition_incomplete' });
    else if (days.some((d) => d.proteinG! < PROTEIN_SHORT * targets.proteinG!)) limitations.push({ code: 'protein_short' });
  }

  // Budget: a fit is only claimed when every price is known and in the budget currency.
  let budget: MealPlan['budget'] = { status: 'none', total: null, limit: null, currency: null };
  if (prefs.budget) {
    const { amount, currency } = prefs.budget;
    const prices = days.flatMap((d) => d.meals.map((m) => m.price));
    if (prices.some((p) => p === null)) {
      budget = { status: 'unknown', total: null, limit: amount, currency };
      limitations.push({ code: 'budget_unknown' });
    } else if (prices.some((p) => p!.currency !== currency)) {
      budget = { status: 'unknown', total: null, limit: amount, currency };
      limitations.push({ code: 'budget_currency_mismatch' });
    } else {
      const total = Math.max(...days.map((d) => d.price as number));
      const over = total > amount;
      budget = { status: over ? 'over' : 'within', total, limit: amount, currency };
      if (over) limitations.push({ code: 'over_budget' });
    }
  }

  return { days, limitations, excluded, budget };
}
