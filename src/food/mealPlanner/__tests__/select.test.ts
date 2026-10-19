import { selectMeals, type Preferences } from '../select';
import { recipe, withCalories, ing } from '../testing/fixtures';

const prefs = (over: Partial<Preferences> = {}): Preferences => ({ cooking: ['stovetop', 'rice_cooker', 'oven', 'microwave', 'kettle'], maxMinutes: null, diets: [], avoid: [], budget: null, mealsPerDay: 3, days: 1, ...over });
const targets = { calories: 1500, proteinG: 90 };
const codes = (plan: ReturnType<typeof selectMeals>) => plan.limitations.map((l) => l.code);

describe('selectMeals: reviewed recipes only, deterministic', () => {
  it('plans meals for each day and slot from reviewed recipes, scaled towards the calorie target', () => {
    const plan = selectMeals(prefs(), [recipe('bowl'), recipe('stew')], targets);

    expect(plan.days).toHaveLength(1);
    expect(plan.days[0].meals).toHaveLength(3);
    // 1500 kcal over 3 meals is 500 kcal each: one serving of a 500 kcal recipe
    expect(plan.days[0].meals.every((m) => m.servings === 1)).toBe(true);
    expect(plan.days[0].calories).toBe(1500);
  });

  it('is deterministic: the same inputs give the same plan, whatever order the recipes arrive in', () => {
    const recipes = [recipe('a'), recipe('b'), recipe('c')];

    expect(selectMeals(prefs({ days: 7 }), [...recipes].reverse(), targets)).toEqual(selectMeals(prefs({ days: 7 }), recipes, targets));
  });

  it('never uses a recipe that is not published and shared: drafts, in review and private ones are left out', () => {
    const plan = selectMeals(prefs(), [recipe('draft', { status: 'draft' }), recipe('review', { status: 'in_review' }), recipe('mine', { userId: 'u1', status: 'private', reviewer: null }), recipe('ok')], targets);

    expect(new Set(plan.days[0].meals.map((m) => m.recipeId))).toEqual(new Set(['ok']));
    expect(plan.excluded.unreviewed).toBe(3);
  });

  it('rotates recipes so the same dish is not repeated when others are available', () => {
    const plan = selectMeals(prefs(), [recipe('a'), recipe('b'), recipe('c')], targets);

    expect(new Set(plan.days[0].meals.map((m) => m.recipeId)).size).toBe(3);
  });

  it('picks fractional servings to land near a smaller target', () => {
    const plan = selectMeals(prefs({ mealsPerDay: 4 }), [recipe('a'), recipe('b'), recipe('c'), recipe('d')], { calories: 1000, proteinG: null });

    expect(plan.days[0].meals.every((m) => m.servings === 0.5)).toBe(true); // 250 kcal slots from 500 kcal servings
    expect(plan.days[0].meals[0].nutrition!.calories).toBe(250);
  });
});

describe('selectMeals: what the member can actually cook and has time for', () => {
  it('offers only recipes needing no cooker when the member has none', () => {
    const plan = selectMeals(prefs({ cooking: [] }), [recipe('stove'), recipe('salad', { cooking: ['none'] }), recipe('no-list', { cooking: [] })], targets);

    expect(new Set(plan.days[0].meals.map((m) => m.recipeId))).toEqual(new Set(['salad', 'no-list']));
    expect(plan.excluded.equipment).toBe(1);
  });

  it('needs every piece of equipment a recipe lists', () => {
    const plan = selectMeals(prefs({ cooking: ['stovetop'] }), [recipe('both', { cooking: ['stovetop', 'oven'] }), recipe('stove')], targets);

    expect(plan.days[0].meals.every((m) => m.recipeId === 'stove')).toBe(true);
  });

  it('respects a short preparation time and counts recipes with unknown times out, since they cannot be confirmed', () => {
    const plan = selectMeals(prefs({ maxMinutes: 15 }), [recipe('slow', { prepMinutes: 20, cookMinutes: 10 }), recipe('quick', { prepMinutes: 5, cookMinutes: 5 }), recipe('unknown', { prepMinutes: null })], targets);

    expect(new Set(plan.days[0].meals.map((m) => m.recipeId))).toEqual(new Set(['quick']));
    expect(plan.excluded.too_long).toBe(1);
    expect(plan.excluded.time_unknown).toBe(1);
  });

  it('applies no time limit when none is set, even to recipes with unknown times', () => {
    const plan = selectMeals(prefs({ maxMinutes: null }), [recipe('unknown', { prepMinutes: null, cookMinutes: null })], targets);

    expect(plan.days[0].meals).toHaveLength(3);
  });
});

describe('selectMeals: diet and allergy choices', () => {
  it('offers only vegetarian recipes to a vegetarian, and counts vegan ones as vegetarian', () => {
    const plan = selectMeals(prefs({ diets: ['vegetarian'] }), [recipe('veg', { dietLabels: ['vegetarian'] }), recipe('vegan', { dietLabels: ['vegan'] }), recipe('plain')], targets);

    expect(new Set(plan.days[0].meals.map((m) => m.recipeId))).toEqual(new Set(['veg', 'vegan']));
    expect(plan.excluded.diet).toBe(1);
  });

  it('offers vegan recipes only to a vegan', () => {
    const plan = selectMeals(prefs({ diets: ['vegan'] }), [recipe('veg', { dietLabels: ['vegetarian'] }), recipe('vegan', { dietLabels: ['vegan'] })], targets);

    expect(plan.days[0].meals.every((m) => m.recipeId === 'vegan')).toBe(true);
  });

  it('avoids an allergen only with a recipe that claims to be free of it', () => {
    const plan = selectMeals(prefs({ avoid: ['peanut'] }), [recipe('safe', { freeFrom: ['peanut'] }), recipe('unlabelled')], targets);

    expect(plan.days[0].meals.every((m) => m.recipeId === 'safe')).toBe(true);
    expect(plan.excluded.allergen).toBe(1);
  });
});

describe('selectMeals: no suitable recipes', () => {
  it('says so, with the reasons, and plans nothing, rather than inventing meals', () => {
    const plan = selectMeals(prefs({ diets: ['vegan'] }), [recipe('plain')], targets);

    expect(plan.days).toEqual([]);
    expect(codes(plan)).toEqual(['no_matching_recipes']);
    expect(plan.excluded.diet).toBe(1);
  });

  it('plans nothing when there are no recipes at all', () => {
    const plan = selectMeals(prefs(), [], targets);

    expect(plan.days).toEqual([]);
    expect(codes(plan)).toEqual(['no_matching_recipes']);
  });
});

describe('selectMeals: calorie and protein targets', () => {
  it('still plans without targets, but says it could not check them, and uses one serving', () => {
    const plan = selectMeals(prefs(), [recipe('a'), recipe('b'), recipe('c')], { calories: null, proteinG: null });

    expect(codes(plan)).toContain('no_targets');
    expect(plan.days[0].meals.every((m) => m.servings === 1)).toBe(true);
  });

  it('leaves out recipes with unknown calories when there is a calorie target to meet', () => {
    const plan = selectMeals(prefs(), [recipe('known'), recipe('unknown', { nutrition: withCalories(null) })], targets);

    expect(plan.days[0].meals.every((m) => m.recipeId === 'known')).toBe(true);
    expect(plan.excluded.nutrition_unknown).toBe(1);
  });

  it('reports a day that is well off the calorie target, and a protein shortfall, instead of hiding it', () => {
    const plan = selectMeals(prefs(), [recipe('big', { nutrition: withCalories(900, 10) })], { calories: 1500, proteinG: 120 });

    expect(codes(plan)).toEqual(expect.arrayContaining(['protein_short']));
  });

  it('does not claim the protein target is met when a recipe protein value is unknown', () => {
    const plan = selectMeals(prefs(), [recipe('a', { nutrition: withCalories(500, null) })], targets);

    expect(codes(plan)).toContain('nutrition_incomplete');
    expect(plan.days[0].proteinG).toBeNull();
  });
});

describe('selectMeals: budget and currency', () => {
  const budget = (amount: number, currency = 'MYR') => ({ amount, currency, per: 'day' as const });

  it('has no budget statement when the member gave none', () => {
    expect(selectMeals(prefs(), [recipe('a')], targets).budget.status).toBe('none');
  });

  it('says the cost is unknown, and never that the plan fits, when a recipe has no price', () => {
    const plan = selectMeals(prefs({ budget: budget(100) }), [recipe('priced'), recipe('unpriced', { price: null })], targets);

    expect(plan.budget.status).toBe('unknown');
    expect(plan.budget.total).toBeNull();
    expect(codes(plan)).toContain('budget_unknown');
  });

  it('says within budget only when every price is known and in the budget currency', () => {
    const plan = selectMeals(prefs({ budget: budget(30) }), [recipe('a'), recipe('b'), recipe('c')], targets);

    expect(plan.budget).toMatchObject({ status: 'within', total: 9, currency: 'MYR' });
  });

  it('reports an impossible budget as over budget with the real cost', () => {
    const plan = selectMeals(prefs({ budget: budget(2) }), [recipe('a'), recipe('b'), recipe('c')], targets);

    expect(plan.budget).toMatchObject({ status: 'over', total: 9 });
    expect(codes(plan)).toContain('over_budget');
  });

  it('does not compare prices in another currency with the budget', () => {
    const plan = selectMeals(prefs({ budget: budget(100, 'SGD') }), [recipe('a'), recipe('b'), recipe('c')], targets);

    expect(plan.budget.status).toBe('unknown');
    expect(codes(plan)).toContain('budget_currency_mismatch');
  });

  it('prices fractional servings by their share of the quoted price', () => {
    const plan = selectMeals(prefs({ mealsPerDay: 4, budget: budget(100) }), [recipe('a'), recipe('b'), recipe('c'), recipe('d')], { calories: 1000, proteinG: null });

    expect(plan.days[0].meals[0].price).toEqual({ amount: 1.5, currency: 'MYR' }); // half a serving of a 6 per 2 servings recipe
  });
});

describe('selectMeals: a week', () => {
  it('plans each day, rotating recipes across days', () => {
    const plan = selectMeals(prefs({ days: 7, mealsPerDay: 1 }), [recipe('a'), recipe('b'), recipe('c')], { calories: 500, proteinG: null });

    expect(plan.days).toHaveLength(7);
    expect(plan.days.map((d) => d.meals[0].recipeId).slice(0, 3)).toEqual(['a', 'b', 'c']);
  });

  it('refuses a plan length outside 1 to 7 days', () => {
    expect(() => selectMeals(prefs({ days: 0 }), [recipe('a')], targets)).toThrow(/days/i);
    expect(() => selectMeals(prefs({ days: 8 }), [recipe('a')], targets)).toThrow(/days/i);
  });
});

describe('selectMeals does not change its inputs', () => {
  it('leaves the recipes untouched', () => {
    const recipes = [recipe('a', { ingredients: [ing('rice', 100)] }), recipe('b')];
    const before = JSON.stringify(recipes);

    selectMeals(prefs(), recipes, targets);

    expect(JSON.stringify(recipes)).toBe(before);
  });
});
