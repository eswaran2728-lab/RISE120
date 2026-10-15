// A tiny in-memory signal that an account's plan changed on the server (for example a coach proposal was accepted).
// Screens that keep a plan in memory compare versions so that, if they cannot read the new plan, they drop the old
// one instead of showing it as current.
const versions = new Map<string, number>();

export function getPlanVersion(userId: string): number {
  return versions.get(userId) ?? 0;
}

export function notifyPlanChanged(userId: string): void {
  versions.set(userId, getPlanVersion(userId) + 1);
}
