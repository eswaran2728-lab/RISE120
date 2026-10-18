// A tiny in-process signal that a set was just queued for an account. Listeners (such as the reminder sync)
// re-read what they need from the stored data; the signal carries no workout details.
type Listener = (userId: string) => unknown;
const listeners = new Set<Listener>();

export function onWorkoutSetLogged(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function notifyWorkoutSetLogged(userId: string): void {
  for (const listener of [...listeners]) {
    try {
      void Promise.resolve(listener(userId)).catch(() => undefined);
    } catch {
      // One listener failing must never stop a set being logged.
    }
  }
}
