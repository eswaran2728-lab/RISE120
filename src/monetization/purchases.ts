// Store purchases for premium. The store is only where money changes hands: premium itself comes from the
// server (RevenueCat webhook -> entitlement), so after any purchase or restore this asks check-limit what the
// server now says and never records access on the device.
import type { LimitSnapshot } from './limits';

export type PackageKind = 'monthly' | 'yearly' | 'lifetime';

export interface StorePackage {
  id: string;
  kind: PackageKind;
  priceString: string; // localized price as fetched from the store; never a built-in number
  title: string;
  native: unknown; // the SDK's own package object, handed back to purchase()
}

// The thin boundary around the native store SDK, so the logic below runs in plain Jest.
export interface PurchasesSdk {
  isConfigured(): boolean;
  logIn(userId: string): Promise<void>;
  logOut(): Promise<void>;
  getPackages(): Promise<StorePackage[] | null>; // null = no current offering
  purchase(pkg: StorePackage): Promise<void>; // rejects with { cancelled: true } if the user backed out
  restore(): Promise<{ hasActiveEntitlement: boolean }>;
}

export type OfferResult = { status: 'ready'; packages: StorePackage[] } | { status: 'unavailable' } | { status: 'not_configured' };
export type PurchaseResult = 'premium' | 'processing' | 'cancelled' | 'failed' | 'wrong_account';
export type RestoreResult = 'premium' | 'processing' | 'nothing_found' | 'failed' | 'wrong_account';

export interface PurchaseService {
  syncIdentity(userId: string | null): Promise<void>;
  loadOffer(): Promise<OfferResult>;
  purchase(userId: string, pkg: StorePackage): Promise<PurchaseResult>;
  restore(userId: string): Promise<RestoreResult>;
}

interface Options {
  sdk: PurchasesSdk;
  loadLimits: (userId: string) => Promise<LimitSnapshot>;
  pollDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

const KIND_ORDER: PackageKind[] = ['monthly', 'yearly', 'lifetime'];
// The webhook usually lands within seconds; wait a little, then say "still confirming" rather than guess.
const DEFAULT_POLL_DELAYS_MS = [1000, 2000, 3000, 5000, 8000];

export function createPurchaseService({ sdk, loadLimits, pollDelaysMs = DEFAULT_POLL_DELAYS_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }: Options): PurchaseService {
  // Who the store customer should be (`desired`) and who the SDK has actually confirmed it is (`sdkUser`).
  // Changes are applied one at a time by a single loop, so a slow login can never be overtaken by a later
  // login or logout and leave the SDK on the wrong customer. An action is allowed only when the SDK is
  // confirmed to be the account asking, which also holds purchases and restores back while a change is pending.
  let desired: string | null = null;
  let sdkUser: string | null = null;
  let applying = false;
  let current: Promise<void> = Promise.resolve();

  const confirmed = (userId: string) => !applying && sdkUser === userId && desired === userId;

  async function apply(): Promise<void> {
    try {
      while (sdkUser !== desired) {
        const target = desired;
        try {
          if (target === null) await sdk.logOut();
          else await sdk.logIn(target);
          sdkUser = target;
        } catch {
          // The SDK refuses to log out an anonymous customer, which is already the goal. A failed login leaves
          // the account unconfirmed, so purchases stay blocked until a later sync succeeds.
          if (target !== null) return;
          sdkUser = null;
        }
      }
    } finally {
      applying = false;
    }
  }

  async function waitForPremium(userId: string): Promise<'premium' | 'processing' | 'wrong_account'> {
    for (const delay of pollDelaysMs) {
      await sleep(delay);
      if (!confirmed(userId)) return 'wrong_account';
      try {
        if ((await loadLimits(userId)).tier === 'premium') return 'premium';
      } catch {
        // Offline or a hiccup: keep waiting.
      }
    }
    return 'processing';
  }

  return {
    syncIdentity(userId) {
      if (!sdk.isConfigured()) return Promise.resolve();
      desired = userId;
      if (!applying) {
        applying = true;
        current = apply();
      }
      return current;
    },

    async loadOffer() {
      if (!sdk.isConfigured()) return { status: 'not_configured' };
      try {
        const packages = await sdk.getPackages();
        if (!packages || packages.length === 0) return { status: 'unavailable' };
        const ordered = KIND_ORDER.flatMap((kind) => packages.filter((pkg) => pkg.kind === kind));
        return ordered.length === 0 ? { status: 'unavailable' } : { status: 'ready', packages: ordered };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async purchase(userId, pkg) {
      if (!confirmed(userId)) return 'wrong_account';
      try {
        await sdk.purchase(pkg);
      } catch (error) {
        return (error as { cancelled?: boolean })?.cancelled ? 'cancelled' : 'failed';
      }
      return waitForPremium(userId);
    },

    async restore(userId) {
      if (!confirmed(userId)) return 'wrong_account';
      let hasActiveEntitlement: boolean;
      try {
        ({ hasActiveEntitlement } = await sdk.restore());
      } catch {
        return 'failed';
      }
      if (hasActiveEntitlement) return waitForPremium(userId);
      try {
        return (await loadLimits(userId)).tier === 'premium' ? 'premium' : 'nothing_found';
      } catch {
        return 'nothing_found';
      }
    },
  };
}
