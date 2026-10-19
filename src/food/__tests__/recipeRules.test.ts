import { validateRecipes, type FoodIndex } from '../recipeRules';
import type { Recipe, RecipeIngredient } from '../recipes';

// SYNTHETIC fixtures only: not real recipes, not real nutrition values, no real reviewer or source.
const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
const reviewer = { name: 'Fixture Reviewer', role: 'Fixture role', reviewedOn: '2000-01-01' };
const provenance = { name: 'Fixture source', url: null, recordId: 'FX-1', version: '2000.1', accessedOn: '2000-01-02', licenceEvidence: 'Fixture licence evidence' };
const ing = (sourceId: string, over: Partial<RecipeIngredient> = {}): RecipeIngredient => ({ ref: { source: 'fixture', sourceId }, name: sourceId, amount: 100, unit: 'g', tags: [], ...over });
const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: 'fixture-bowl', version: 1, userId: null, status: 'draft', verified: false, region: 'MY',
  name: L('Fixture bowl'), aliases: {}, servings: 2, ingredients: [ing('rice'), ing('egg', { tags: ['egg'] })],
  preparation: [L('Cook it.')], prepMinutes: 10, cookMinutes: 15, cooking: ['stovetop'],
  dietLabels: [], freeFrom: [],
  nutrition: { perServing: { basis: 'per_serving', calories: 400, proteinG: 20, carbsG: 50, fatG: 12, fibreG: null, sugarG: null, sodiumMg: null }, provenance },
  price: null, reviewer: null,
  ...over,
});
const published = (over: Partial<Recipe> = {}) => recipe({ status: 'published', reviewer, ...over });
const codes = (recipes: Recipe[], foods?: FoodIndex) => validateRecipes(recipes, foods).map((e) => `${e.code}:${e.id}`);

describe('portions and yield', () => {
  it('accepts a clean draft and a clean published recipe', () => {
    expect(codes([recipe()])).toEqual([]);
    expect(codes([published()])).toEqual([]);
  });

  it.each([0, -1, NaN])('refuses a yield of %s servings', (servings) => {
    expect(codes([recipe({ servings })])).toContain('bad_servings:fixture-bowl');
  });

  it('refuses ingredients with no amount, a non-positive amount or an unknown unit, and a recipe with none', () => {
    expect(codes([recipe({ ingredients: [] })])).toContain('no_ingredients:fixture-bowl');
    expect(codes([recipe({ ingredients: [ing('rice', { amount: 0 })] })])).toContain('bad_ingredient:fixture-bowl');
    expect(codes([recipe({ ingredients: [ing('rice', { unit: 'handful' as never })] })])).toContain('bad_ingredient:fixture-bowl');
    expect(codes([recipe({ ingredients: [ing('rice', { ref: { source: '', sourceId: 'x' } })] })])).toContain('bad_ingredient:fixture-bowl');
  });
});

describe('missing nutrients and the nutrition source', () => {
  it('lets unknown nutrients stay null: a recipe with only calories known is fine', () => {
    const r = recipe({ nutrition: { perServing: { basis: 'per_serving', calories: 400, proteinG: null, carbsG: null, fatG: null, fibreG: null, sugarG: null, sodiumMg: null }, provenance } });

    expect(codes([r])).toEqual([]);
  });

  it('refuses a negative nutrient, and values that are not per serving', () => {
    const base = recipe().nutrition!;

    expect(codes([recipe({ nutrition: { ...base, perServing: { ...base.perServing, proteinG: -1 } } })])).toContain('bad_nutrient:fixture-bowl');
    expect(codes([recipe({ nutrition: { ...base, perServing: { ...base.perServing, basis: 'per_100g' as never } } })])).toContain('nutrition_basis:fixture-bowl');
  });

  it('flags energy that cannot be right for the macronutrients (a unit or serving mix-up)', () => {
    const base = recipe().nutrition!;

    expect(codes([recipe({ nutrition: { ...base, perServing: { ...base.perServing, calories: 1500 } } })])).toContain('nutrition_inconsistent:fixture-bowl');
  });

  it('requires a published recipe to name its nutrition source, version, access date and licence evidence', () => {
    const base = recipe().nutrition!;

    expect(codes([published({ nutrition: null })])).toContain('missing_nutrition_source:fixture-bowl');
    expect(codes([published({ nutrition: { ...base, provenance: { ...provenance, version: '' } } })])).toContain('missing_nutrition_source:fixture-bowl');
    expect(codes([published({ nutrition: { ...base, provenance: { ...provenance, licenceEvidence: ' ' } } })])).toContain('missing_nutrition_source:fixture-bowl');
    expect(codes([published({ nutrition: { ...base, provenance: { ...provenance, accessedOn: 'yesterday' } } })])).toContain('missing_nutrition_source:fixture-bowl');
  });
});

describe('diet and allergy claims must be supported by the ingredients', () => {
  it('supports vegetarian only when no ingredient is meat, pork, fish or shellfish', () => {
    expect(codes([recipe({ dietLabels: ['vegetarian'] })])).toEqual([]);
    expect(codes([recipe({ dietLabels: ['vegetarian'], ingredients: [ing('rice'), ing('chicken', { tags: ['meat'] })] })])).toContain('diet_label_unsupported:fixture-bowl');
    expect(codes([recipe({ dietLabels: ['vegetarian'], ingredients: [ing('prawn', { tags: ['shellfish'] })] })])).toContain('diet_label_unsupported:fixture-bowl');
  });

  it('supports vegan only when there is also no dairy, egg or honey', () => {
    expect(codes([recipe({ dietLabels: ['vegan'] })])).toContain('diet_label_unsupported:fixture-bowl'); // the egg
    expect(codes([recipe({ dietLabels: ['vegan'], ingredients: [ing('rice'), ing('tofu', { tags: ['soy'] })] })])).toEqual([]);
  });

  it('never supports a claim when an ingredient has unknown tags: unknown is not safe', () => {
    const unknown = recipe({ dietLabels: ['vegetarian'], freeFrom: ['peanut'], ingredients: [ing('rice'), ing('sauce', { tags: null })] });

    expect(codes([unknown])).toEqual(expect.arrayContaining(['diet_label_unsupported:fixture-bowl', 'free_from_unsupported:fixture-bowl']));
  });

  it('supports a free-from claim only when no ingredient carries that allergen', () => {
    expect(codes([recipe({ freeFrom: ['peanut'] })])).toEqual([]);
    expect(codes([recipe({ freeFrom: ['egg'] })])).toContain('free_from_unsupported:fixture-bowl');
    expect(codes([recipe({ freeFrom: ['peanut'], ingredients: [ing('satay', { tags: ['peanut'] })] })])).toContain('free_from_unsupported:fixture-bowl');
  });

  it('refuses labels it cannot support from ingredients at all, such as halal (a certification, not a property of ingredients)', () => {
    expect(codes([recipe({ dietLabels: ['halal' as never] })])).toContain('diet_label_unknown:fixture-bowl');
    expect(codes([recipe({ freeFrom: ['nothing-at-all' as never] })])).toContain('free_from_unknown:fixture-bowl');
  });
});

describe('price and currency', () => {
  const price = { amount: 8.5, currency: 'MYR', pricedOn: '2000-01-03', servings: 2, source: 'Fixture price check' };

  it('allows no price at all: unknown stays null', () => {
    expect(codes([recipe({ price: null })])).toEqual([]);
  });

  it('accepts a dated price in the currency of the recipes region', () => {
    expect(codes([recipe({ price })])).toEqual([]);
  });

  it('refuses a price in another currency than the region (a Malaysian recipe priced in dollars)', () => {
    expect(codes([recipe({ price: { ...price, currency: 'USD' } })])).toContain('price_currency_mismatch:fixture-bowl');
    expect(codes([recipe({ price: { ...price, currency: 'ringgit' } })])).toContain('price_invalid:fixture-bowl');
  });

  it('refuses a negative price, a price with no date or source, and a price for zero servings', () => {
    expect(codes([recipe({ price: { ...price, amount: -1 } })])).toContain('price_invalid:fixture-bowl');
    expect(codes([recipe({ price: { ...price, pricedOn: '' } })])).toContain('price_invalid:fixture-bowl');
    expect(codes([recipe({ price: { ...price, source: '' } })])).toContain('price_invalid:fixture-bowl');
    expect(codes([recipe({ price: { ...price, servings: 0 } })])).toContain('price_invalid:fixture-bowl');
  });
});

describe('publication, review and verification', () => {
  it('requires a complete reviewer, names in all three languages, and preparation steps to publish', () => {
    expect(codes([published({ reviewer: null })])).toContain('missing_review:fixture-bowl');
    expect(codes([published({ name: { en: 'x', ms: '', ta: 'x' } })])).toContain('missing_name:fixture-bowl');
    expect(codes([published({ preparation: [] })])).toContain('missing_preparation:fixture-bowl');
  });

  it('never allows verified on something unpublished or unreviewed', () => {
    expect(codes([recipe({ verified: true })])).toContain('verified_unreviewed:fixture-bowl');
    expect(codes([published({ verified: true, reviewer: null })])).toContain('verified_unreviewed:fixture-bowl');
    expect(codes([published({ verified: true })])).toEqual([]);
  });

  it('keeps a private recipe private: it can never be published, verified or reviewed', () => {
    expect(codes([recipe({ userId: 'u1', status: 'private' })])).toEqual([]);
    expect(codes([recipe({ userId: 'u1', status: 'published', reviewer })])).toContain('private_not_private:fixture-bowl');
    expect(codes([recipe({ userId: 'u1', status: 'private', verified: true })])).toContain('private_not_private:fixture-bowl');
  });
});

describe('duplicates', () => {
  it('flags the same recipe version appearing twice (a duplicate import), but not a new version', () => {
    expect(codes([recipe(), recipe()])).toContain('duplicate_recipe:fixture-bowl');
    expect(codes([recipe(), recipe({ version: 2 })])).toEqual([]);
  });

  it('allows a shared and a private recipe to share an id, because they are different owners', () => {
    expect(codes([recipe(), recipe({ userId: 'u1', status: 'private' })])).toEqual([]);
    expect(codes([recipe({ userId: 'u1', status: 'private' }), recipe({ userId: 'u2', status: 'private' })])).toEqual([]);
  });
});

describe('shared and private ingredient references', () => {
  const foods: FoodIndex = new Map([
    ['fixture:rice', { userId: null }],
    ['fixture:egg', { userId: null }],
    ['fixture:mine', { userId: 'u1' }],
  ]);

  it('lets a shared recipe use only shared foods', () => {
    expect(codes([published()], foods)).toEqual([]);
    expect(codes([published({ ingredients: [ing('mine')] })], foods)).toContain('ingredient_private:fixture-bowl');
    expect(codes([published({ ingredients: [ing('ghost')] })], foods)).toContain('ingredient_unknown:fixture-bowl');
  });

  it('lets a private recipe use shared foods and its own, never another accounts', () => {
    const mine = recipe({ userId: 'u1', status: 'private', ingredients: [ing('rice'), ing('mine')] });
    const theirs = recipe({ userId: 'u2', status: 'private', ingredients: [ing('rice'), ing('mine')] });

    expect(codes([mine], foods)).toEqual([]);
    expect(codes([theirs], foods)).toContain('ingredient_private:fixture-bowl');
  });

  it('does not check references when no food index is given (offline content check)', () => {
    expect(codes([published({ ingredients: [ing('ghost')] })])).toEqual([]);
  });
});

describe('regional names', () => {
  it('accepts reviewed aliases and refuses blank or non-text ones', () => {
    expect(codes([recipe({ aliases: { en: ['Fixture bowl'], ms: ['Mangkuk'], ta: ['கிண்ணம்'] } })])).toEqual([]);
    expect(codes([recipe({ aliases: { ms: [' '] } })])).toContain('alias_invalid:fixture-bowl');
    expect(codes([recipe({ aliases: { ta: [5 as never] } })])).toContain('alias_invalid:fixture-bowl');
    expect(codes([recipe({ aliases: { fr: ['x'] } as never })])).toContain('alias_invalid:fixture-bowl');
  });
});
