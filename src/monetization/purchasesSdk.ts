// RevenueCat (react-native-purchases) behind the PurchasesSdk boundary. Only the public SDK key is used;
// private keys never belong in the app. Nothing here logs purchase tokens or customer identifiers.
import type { PackageKind, PurchasesSdk, StorePackage } from './purchases';

const KIND_BY_TYPE: Record<string, PackageKind> = { MONTHLY: 'monthly', ANNUAL: 'yearly', LIFETIME: 'lifetime' };

const unconfigured: PurchasesSdk = {
  isConfigured: () => false,
  logIn: async () => undefined,
  logOut: async () => undefined,
  getPackages: async () => null,
  purchase: async () => {
    throw new Error('Purchases are not configured');
  },
  restore: async () => ({ hasActiveEntitlement: false }),
};

export function createRevenueCatSdk(apiKey: string | null): PurchasesSdk {
  if (!apiKey) return unconfigured;

  // Loaded lazily: the native module does not exist in Jest or in a build made before it was added.
  let module: { default: any; PURCHASES_ERROR_CODE?: Record<string, string> };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    module = require('react-native-purchases');
  } catch {
    return unconfigured;
  }
  const Purchases = module.default;
  Purchases.configure({ apiKey });

  const isCancel = (error: any) => error?.userCancelled === true || error?.code === module.PURCHASES_ERROR_CODE?.PURCHASE_CANCELLED_ERROR;

  return {
    isConfigured: () => true,
    async logIn(userId) {
      await Purchases.logIn(userId);
    },
    async logOut() {
      await Purchases.logOut();
    },
    async getPackages() {
      const offerings = await Purchases.getOfferings();
      const current = offerings?.current;
      if (!current) return null;
      return (current.availablePackages as any[]).flatMap((pkg): StorePackage[] => {
        const kind = KIND_BY_TYPE[String(pkg.packageType)];
        return kind ? [{ id: pkg.identifier, kind, priceString: pkg.product.priceString, title: pkg.product.title, native: pkg }] : [];
      });
    },
    async purchase(pkg) {
      try {
        await Purchases.purchasePackage(pkg.native);
      } catch (error) {
        throw isCancel(error) ? Object.assign(new Error('Purchase cancelled'), { cancelled: true }) : new Error('Purchase failed');
      }
    },
    async restore() {
      const info = await Purchases.restorePurchases();
      return { hasActiveEntitlement: Object.keys(info?.entitlements?.active ?? {}).length > 0 };
    },
  };
}
