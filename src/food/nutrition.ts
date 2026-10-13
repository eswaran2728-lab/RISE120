import type { Nutrition, TargetsLike } from './types';

// Two decimals removes floating point noise (0.1 + 0.2) without losing real precision.
const round2 = (n: number) => Math.round(n * 100) / 100;

const ZERO: Nutrition = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };

// Quantity is the number of listed servings.
export function foodNutrition(food: Nutrition, quantity: number): Nutrition {
  if (quantity < 0) throw new Error('Quantity cannot be negative');
  return {
    calories: round2(food.calories * quantity),
    proteinG: round2(food.proteinG * quantity),
    carbsG: round2(food.carbsG * quantity),
    fatG: round2(food.fatG * quantity),
  };
}

// Totals are summed exactly and rounded once, so many small entries do not drift.
export function sumNutrition(entries: Nutrition[]): Nutrition {
  const total = entries.reduce(
    (sum, entry) => ({
      calories: sum.calories + entry.calories,
      proteinG: sum.proteinG + entry.proteinG,
      carbsG: sum.carbsG + entry.carbsG,
      fatG: sum.fatG + entry.fatG,
    }),
    ZERO
  );
  return { calories: round2(total.calories), proteinG: round2(total.proteinG), carbsG: round2(total.carbsG), fatG: round2(total.fatG) };
}

// A missing target stays missing (no invented zero). A negative result means over the target.
export function remainingNutrition(targets: TargetsLike, consumed: Nutrition): TargetsLike {
  return {
    calories: targets.calories === null ? null : round2(targets.calories - consumed.calories),
    proteinG: targets.proteinG === null ? null : round2(targets.proteinG - consumed.proteinG),
  };
}

