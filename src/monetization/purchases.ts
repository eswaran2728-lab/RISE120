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
  // Who the store SDK is currently identified as. Every action is checked against it, so a purchase can
  // never be attributed to (or read for) a different account than the one that started it.
  let identity: string | null = null;

  async function waitForPremium(userId: string): Promise<'premium' | 'processing' | 'wrong_account'> {
    for (const delay of pollDelaysMs) {
      await sleep(delay);
      if (identity !== userId) return 'wrong_account';
      try {
        if ((await loadLimits(userId)).tier === 'premium') return 'premium';
      } catch {
        // Offline or a hiccup: keep waiting.
      }
    }
    return 'processing';
  }

  return {
    async syncIdentity(userId) {
      if (!sdk.isConfigured() || userId === identity) return;
      if (userId === null) {
        identity = null;
        try {
          await sdk.logOut();
        } catch {
          // The SDK refuses to log out an anonymous customer; nothing to undo.
        }
        return;
      }
      try {
        await sdk.logIn(userId);
        identity = userId;
      } catch {
        // Leave the identity as it was: purchases then refuse until a later sync succeeds.
      }
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
      if (identity !== userId) return 'wrong_account';
      try {
        await sdk.purchase(pkg);
      } catch (error) {
        return (error as { cancelled?: boolean })?.cancelled ? 'cancelled' : 'failed';
      }
      return waitForPremium(userId);
    },

    async restore(userId) {
      if (identity !== userId) return 'wrong_account';
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
