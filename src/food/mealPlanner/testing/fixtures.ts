import type { Cooking, Recipe, RecipeIngredient } from '../../recipes';

// SYNTHETIC reviewed recipes for tests only: not real recipes, nutrition, prices or reviewers.
export const L = (text: string) => ({ en: text, ms: `${text} ms`, ta: `${text} ta` });
export const reviewer = { name: 'Fixture Reviewer', role: 'Fixture role', reviewedOn: '2000-01-01' };
export const ing = (sourceId: string, amount: number, unit: RecipeIngredient['unit'] = 'g', over: Partial<RecipeIngredient> = {}): RecipeIngredient => ({ ref: { source: 'fixture', sourceId }, name: sourceId, amount, unit, tags: [], ...over });

export const recipe = (id: string, over: Partial<Recipe> = {}): Recipe => ({
  id, version: 1, userId: null, status: 'published', verified: false, region: 'MY', name: L(id), aliases: {}, servings: 2,
  ingredients: [ing('rice', 200)], preparation: [L('Cook.')], prepMinutes: 10, cookMinutes: 10, cooking: ['stovetop' as Cooking],
  dietLabels: [], freeFrom: [],
  nutrition: { perServing: { basis: 'per_serving', calories: 500, proteinG: 25, carbsG: 60, fatG: 14, fibreG: null, sugarG: null, sodiumMg: null }, provenance: { name: 'Fixture', url: null, recordId: null, version: '1', accessedOn: '2000-01-01', licenceEvidence: 'Fixture' } },
  price: { amount: 6, currency: 'MYR', pricedOn: '2000-01-02', servings: 2, source: 'Fixture' },
  reviewer,
  ...over,
});
export const withCalories = (calories: number | null, proteinG: number | null = 25): Recipe['nutrition'] => ({
  perServing: { basis: 'per_serving', calories, proteinG, carbsG: 60, fatG: 14, fibreG: null, sugarG: null, sodiumMg: null },
  provenance: { name: 'Fixture', url: null, recordId: null, version: '1', accessedOn: '2000-01-01', licenceEvidence: 'Fixture' },
});
