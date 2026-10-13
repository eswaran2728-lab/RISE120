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
