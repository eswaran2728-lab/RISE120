// Lets the onboarding screen tell the root layout that the profile is now
// onboarded, so routing does not send the user back to onboarding.
const listeners = new Set<() => void>();

export function onOnboardingComplete(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyOnboardingComplete(): void {
  listeners.forEach((listener) => listener());
}

const planInputListeners = new Set<() => void>();

export function onPlanInputsSaved(listener: () => void): () => void {
  planInputListeners.add(listener);
  return () => {
    planInputListeners.delete(listener);
  };
}

export function notifyPlanInputsSaved(): void {
  planInputListeners.forEach((listener) => listener());
}
