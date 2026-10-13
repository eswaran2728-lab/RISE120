import { enqueue } from '../sync/queue';
import type { LocalDate } from '../sync/types';
import { rememberFoods } from './cache';
import { Food, MEAL_TYPES, MealType } from './types';

const MAX_QUANTITY = 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// A random v4 UUID. The id is created once per entry (when the sheet opens) and reused for edits
// and retries, so a double tap or a lost response can never make a second meal log.
export function newLogId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export interface FoodLogInput {
  id?: string; // reuse to edit an existing log or to make a retry idempotent
  food: Food;
  quantity: number; // listed servings
  mealType: MealType;
}

// Queues the meal locally first; it syncs when online. Returns the log's stable id.
export async function queueFoodLog(userId: string, date: LocalDate, input: FoodLogInput): Promise<string> {
  if (!DATE.test(date)) throw new Error('Invalid date');
  if (!MEAL_TYPES.includes(input.mealType)) throw new Error('Invalid meal type');
  if (!Number.isFinite(input.quantity) || input.quantity <= 0 || input.quantity > MAX_QUANTITY) throw new Error('Invalid quantity');
  if (!input.food.id) throw new Error('Invalid food');

  const id = input.id ?? newLogId();
  await enqueue(userId, {
    kind: 'food_log',
    id,
    date,
    foodId: input.food.id,
    quantity: input.quantity,
    mealType: input.mealType,
    deleted: false,
    food: input.food,
    updatedAt: Date.now(),
  });
  await rememberFoods(userId, [input.food]);
  return id;
}

// Queues a delete tombstone. It is kept until the server confirms, so deleting offline replays.
export async function queueFoodLogDelete(
  userId: string,
  entry: { id: string; date: LocalDate; foodId: string; quantity: number; mealType: MealType; food: Food | null }
): Promise<void> {
  await enqueue(userId, {
    kind: 'food_log',
    id: entry.id,
    date: entry.date,
    foodId: entry.foodId,
    quantity: entry.quantity,
    mealType: entry.mealType,
    deleted: true,
    food: entry.food,
    updatedAt: Date.now(),
  });
}
