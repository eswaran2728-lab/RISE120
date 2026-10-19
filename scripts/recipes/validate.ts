// `npm run recipes:check` validates content/recipes with the same rules the app and the database apply. Exit code 1 is
// a real problem; having nothing published is reported as an open launch gate, not a failure. A file that cannot be
// read is named but its text is never printed.
import { validateRecipes } from '../../src/food/recipeRules.ts';
import type { Recipe } from '../../src/food/recipes.ts';

export interface RecipeFile {
  path: string;
  text: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const STATUSES = ['draft', 'in_review', 'published', 'private'];

function looksLikeRecipe(v: unknown): v is Recipe {
  return isRecord(v) && typeof v.id === 'string' && typeof v.version === 'number' && typeof v.servings === 'number' && Array.isArray(v.ingredients) && isRecord(v.name) && STATUSES.includes(v.status as string);
}

export function runRecipeValidation(files: RecipeFile[]): { exitCode: number; lines: string[] } {
  const problems: string[] = [];
  const recipes: Recipe[] = [];
  for (const file of files) {
    let value: unknown;
    try {
      value = JSON.parse(file.text);
    } catch {
      problems.push(`${file.path}: not valid JSON`);
      continue;
    }
    if (!looksLikeRecipe(value)) {
      problems.push(`${file.path}: not the expected shape`);
      continue;
    }
    if (value.userId !== null && value.userId !== undefined) {
      problems.push(`${file.path}: content recipes must be shared (no userId)`);
      continue;
    }
    recipes.push({ ...value, userId: null });
  }
  for (const error of validateRecipes(recipes)) problems.push(`${error.code}: ${error.id}`);

  const count = (status: string) => recipes.filter((r) => r.status === status).length;
  const published = count('published');
  const lines = [`recipes: ${recipes.length} (published ${published}, in review ${count('in_review')}, draft ${count('draft')}, private ${count('private')})`, `offered to members: ${published}`];
  if (published === 0) lines.push('Nothing is published yet. Reviewed recipes with sourced nutrition are a launch gate: until they exist the meal planner has nothing to offer.');
  if (problems.length > 0) {
    lines.push(`${problems.length} problem(s):`, ...problems.map((p) => `  ${p}`));
    return { exitCode: 1, lines };
  }
  lines.push('Recipes are valid.');
  return { exitCode: 0, lines };
}
