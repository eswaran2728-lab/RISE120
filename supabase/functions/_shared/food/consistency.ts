export interface Macros {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

// Energy should roughly match 4 kcal/g protein and carbs plus 9 kcal/g fat. A far-off record is
// bad data (mixed units, a missing macro) and must not become a log. Kept identical to the app's
// src/food/validation.ts (a test checks they agree).
export function isEnergyConsistent(n: Macros): boolean {
  const fromMacros = 4 * n.proteinG + 4 * n.carbsG + 9 * n.fatG;
  const tolerance = Math.max(10, 0.35 * Math.max(n.calories, fromMacros));
  return Math.abs(n.calories - fromMacros) <= tolerance;
}
