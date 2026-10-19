// Combines the ingredients of planned meals into a shopping list. Quantities are added only when their units are
// compatible: grams with kilograms, millilitres with litres, and the very same unit otherwise. Anything else stays a
// separate line, because converting a spoon to grams or a piece to millilitres would be a guess.
import { scaleRecipe, type IngredientRef, type Recipe } from '../recipes';
import type { Unit } from '../portions';

export interface ShoppingItem {
  ref: IngredientRef;
  name: string;
  amount: number;
  unit: Unit;
  forRecipes: string[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// The unit a quantity is added in, and the factor to get there.
function base(unit: Unit): { unit: Unit; factor: number } {
  if (unit === 'kg') return { unit: 'g', factor: 1000 };
  if (unit === 'l') return { unit: 'ml', factor: 1000 };
  return { unit, factor: 1 };
}

export function mergeShoppingList(meals: { recipe: Recipe; servings: number }[]): ShoppingItem[] {
  const lines = new Map<string, ShoppingItem>();
  for (const { recipe, servings } of meals) {
    for (const ingredient of scaleRecipe(recipe, servings).ingredients) {
      const { unit, factor } = base(ingredient.unit);
      const key = `${ingredient.ref.source}|${ingredient.ref.sourceId}|${unit}`;
      const line = lines.get(key) ?? { ref: ingredient.ref, name: ingredient.name, amount: 0, unit, forRecipes: [] };
      line.amount += ingredient.amount * factor;
      if (!line.forRecipes.includes(recipe.id)) line.forRecipes.push(recipe.id);
      lines.set(key, line);
    }
  }
  return [...lines.values()]
    .map((l) => ({ ...l, amount: round2(l.amount) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));
}
