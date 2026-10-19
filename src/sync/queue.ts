import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PendingLimit } from '../monetization/errors';
import type { PendingOperation } from './types';

const keyFor = (userId: string) => `rise120.sync.pending.${userId}`;

// Reads and writes for one user run one after another, so concurrent enqueues cannot lose data.
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(userId) ?? Promise.resolve();
  const next = previous.then(task, task);
  locks.set(userId, next.catch(() => undefined));
  return next;
}

async function read(userId: string): Promise<PendingOperation[]> {
  const raw = await AsyncStorage.getItem(keyFor(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingOperation[]) : [];
  } catch {
    return [];
  }
}

async function write(userId: string, operations: PendingOperation[]): Promise<void> {
  if (operations.length === 0) await AsyncStorage.removeItem(keyFor(userId));
  else await AsyncStorage.setItem(keyFor(userId), JSON.stringify(operations));
}

// Two operations with the same key describe the same server row.
export const operationKey = (op: PendingOperation): string => {
  if (op.kind === 'workout_set') return `set:${op.id}`;
  if (op.kind === 'food_log') return `food:${op.id}`;
  if (op.kind === 'recipe_food') return `recipefood:${op.id}`;
  return `checkin:${op.date}`;
};

export function enqueue(userId: string, op: PendingOperation): Promise<void> {
  return withLock(userId, async () => {
    const operations = await read(userId);
    const index = operations.findIndex((existing) => operationKey(existing) === operationKey(op));
    if (index === -1) operations.push(op);
    else if (op.updatedAt >= operations[index].updatedAt) {
      const existing = operations[index];
      // An edit without a new photo must not drop a photo that is still waiting to upload.
      operations[index] =
        op.kind === 'checkin' && existing.kind === 'checkin' && op.photoUri === null
          ? { ...op, photoUri: existing.photoUri }
          : op;
    }
    await write(userId, operations);
  });
}

export function listPending(userId: string): Promise<PendingOperation[]> {
  return withLock(userId, () => read(userId));
}

// Removes a synced operation unless the user edited the same row while it was being sent.
export function removeIfUnchanged(userId: string, op: PendingOperation): Promise<void> {
  return withLock(userId, async () => {
    const operations = await read(userId);
    const remaining = operations.filter(
      (existing) => operationKey(existing) !== operationKey(op) || existing.updatedAt !== op.updatedAt
    );
    if (remaining.length !== operations.length) await write(userId, remaining);
  });
}

// Records why a food log could not sync yet, unless the user edited the same row in the meantime.
export function markBlocked(userId: string, op: PendingOperation, reason: PendingLimit): Promise<void> {
  return withLock(userId, async () => {
    if (op.kind !== 'food_log') return;
    let changed = false;
    const operations = (await read(userId)).map((existing) => {
      if (existing.kind === 'food_log' && operationKey(existing) === operationKey(op) && existing.updatedAt === op.updatedAt) {
        changed = true;
        return { ...existing, blocked: reason };
      }
      return existing;
    });
    if (changed) await write(userId, operations);
  });
}

// After a photo uploads, a newer queued edit may still point at that (now deleted) local file.
// Drop the reference so the edit syncs on its own; the uploaded photo stays on the server.
export function clearPhotoUri(userId: string, date: string, uri: string): Promise<void> {
  return withLock(userId, async () => {
    let changed = false;
    const operations = (await read(userId)).map((op) => {
      if (op.kind === 'checkin' && op.date === date && op.photoUri === uri) {
        changed = true;
        return { ...op, photoUri: null };
      }
      return op;
    });
    if (changed) await write(userId, operations);
  });
}

// The server already held a food for this recipe version under another id: point the queued logs at it. Edit times
// are left alone, so a flush in progress still recognises the entries it is sending.
export function remapFoodId(userId: string, from: string, to: string): Promise<void> {
  return withLock(userId, async () => {
    let changed = false;
    const operations = (await read(userId)).map((op) => {
      if (op.kind === 'food_log' && op.foodId === from) {
        changed = true;
        return { ...op, foodId: to, food: op.food ? { ...op.food, id: to } : op.food };
      }
      return op;
    });
    if (changed) await write(userId, operations);
  });
}

export function clearPending(userId: string): Promise<void> {
  return withLock(userId, () => write(userId, []));
}
