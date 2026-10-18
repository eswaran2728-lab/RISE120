import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { accessStatus, AccessStatus, loadLimitsOrCached } from '../src/monetization/limits';
import { OfferResult, PurchaseResult, RestoreResult, StorePackage } from '../src/monetization/purchases';
import { getPurchaseService } from '../src/monetization/services';

const PURCHASE_MESSAGES: Record<PurchaseResult, string | null> = {
  premium: 'paywall.premiumActive',
  processing: 'paywall.processing',
  cancelled: 'paywall.cancelled',
  failed: 'paywall.failed',
  wrong_account: 'paywall.failed',
};
const RESTORE_MESSAGES: Record<RestoreResult, string> = {
  premium: 'paywall.premiumActive',
  processing: 'paywall.restoreProcessing',
  nothing_found: 'paywall.nothingFound',
  failed: 'paywall.failed',
  wrong_account: 'paywall.failed',
};
const KIND_LABELS = { monthly: 'paywall.monthly', yearly: 'paywall.yearly', lifetime: 'paywall.lifetime' } as const;

// Everything the screen knows belongs to one account. A result that arrives for an account that is no longer
// the signed-in one is dropped, and a view for another account is never displayed.
interface PaywallState {
  userId: string;
  access: AccessStatus;
  offer: OfferResult | null;
  busy: boolean;
  messageKey: string | null;
}

export default function PaywallScreen() {
  useLanguage();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const [state, setState] = useState<PaywallState | null>(null);
  const view = state && state.userId === userId ? state : null;
  const mounted = useRef(true);
  const activeUser = useRef(userId);

  useEffect(() => {
    activeUser.current = userId;
  }, [userId]);

  // Applies a change only if that account is still the one on screen.
  const patch = useCallback((forUser: string, change: Partial<PaywallState>) => {
    if (!mounted.current || activeUser.current !== forUser) return;
    setState((prev) => (prev && prev.userId === forUser ? { ...prev, ...change } : prev));
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    // Premium is whatever the server says; the store sheet below never decides it.
    const [offer, limits] = await Promise.all([getPurchaseService().loadOffer(), loadLimitsOrCached(userId)]);
    if (!mounted.current || activeUser.current !== userId) return;
    setState({ userId, access: accessStatus(limits), offer, busy: false, messageKey: null });
  }, [userId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const retry = () => {
    setState(null);
    void load();
  };

  // After a purchase or restore, ask the server again. This can only confirm premium, never take it away: the
  // purchase service already saw a fresh server answer, and a failed read here proves nothing.
  const confirmPremium = async (forUser: string) => {
    const limits = await loadLimitsOrCached(forUser);
    if (accessStatus(limits) === 'premium') patch(forUser, { access: 'premium' });
  };

  const buy = async (pkg: StorePackage) => {
    if (!userId || !view || view.busy) return;
    const forUser = userId;
    patch(forUser, { busy: true, messageKey: null });
    const result = await getPurchaseService().purchase(forUser, pkg).catch(() => 'failed' as const);
    patch(forUser, { messageKey: PURCHASE_MESSAGES[result] });
    if (result === 'premium') patch(forUser, { access: 'premium' });
    else if (result === 'processing') await confirmPremium(forUser);
    patch(forUser, { busy: false });
  };

  const restore = async () => {
    if (!userId || !view || view.busy) return;
    const forUser = userId;
    patch(forUser, { busy: true, messageKey: null });
    const result = await getPurchaseService().restore(forUser).catch(() => 'failed' as const);
    patch(forUser, { messageKey: RESTORE_MESSAGES[result] });
    if (result === 'premium') patch(forUser, { access: 'premium' });
    else if (result === 'processing') await confirmPremium(forUser);
    patch(forUser, { busy: false });
  };

  const premium = view?.access === 'premium';
  const unverified = view?.access === 'unverified';
  // Products are offered only after a fresh server answer confirmed free. Premium or unknown access gets none:
  // a second purchase for someone who may already be premium could be a double charge.
  const offering = view?.access === 'free';
  const offer = view?.offer ?? null;
  const busy = view?.busy ?? false;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('paywall.title')}</Text>
      <Text style={styles.body}>{t('paywall.body')}</Text>

      {premium ? <Text style={styles.success}>{t('paywall.premiumActive')}</Text> : null}
      {unverified ? (
        <>
          <Text style={styles.message}>{t('paywall.cannotVerify')}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.secondary} onPress={retry}>
            <Text style={styles.secondaryText}>{t('errors.retry')}</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {!view ? <ActivityIndicator color={tokens.color.accent} style={styles.spinner} /> : null}
      {offering && offer?.status === 'not_configured' ? <Text style={styles.meta}>{t('paywall.notConfigured')}</Text> : null}
      {offering && offer?.status === 'unavailable' ? (
        <>
          <Text style={styles.meta}>{t('paywall.unavailable')}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.secondary} onPress={retry}>
            <Text style={styles.secondaryText}>{t('errors.retry')}</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {offering && offer?.status === 'ready'
        ? offer.packages.map((pkg) => (
            <TouchableOpacity key={pkg.id} accessibilityRole="button" disabled={busy} style={[styles.package, busy && styles.dim]} onPress={() => void buy(pkg)}>
              <View>
                <Text style={styles.packageName}>{t(KIND_LABELS[pkg.kind])}</Text>
                <Text style={styles.meta}>{pkg.title}</Text>
              </View>
              {/* The localized price exactly as the store returned it. */}
              <Text style={styles.price}>{pkg.priceString}</Text>
            </TouchableOpacity>
          ))
        : null}

      {view?.messageKey ? <Text style={styles.message}>{t(view.messageKey)}</Text> : null}
      {busy ? <ActivityIndicator color={tokens.color.accent} style={styles.spinner} /> : null}

      {offering && offer && offer.status !== 'not_configured' ? (
        <TouchableOpacity accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => void restore()}>
          <Text style={styles.secondaryText}>{t('paywall.restore')}</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity accessibilityRole="button" style={styles.secondary} onPress={() => router.back()}>
        <Text style={styles.secondaryText}>{t('paywall.close')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const MUTED = tokens.color.textSecondary;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[5], paddingTop: tokens.space[7], paddingBottom: tokens.space[7] },
  title: { color: tokens.color.text, fontSize: 28, fontWeight: '700' },
  body: { color: tokens.color.text, fontSize: 16, lineHeight: 23, marginTop: tokens.space[2], marginBottom: tokens.space[4] },
  meta: { color: MUTED, fontSize: 13, lineHeight: 18 },
  success: { color: tokens.color.accent, fontSize: 18, fontWeight: '600', marginVertical: tokens.space[3] },
  message: { color: tokens.color.text, fontSize: 15, lineHeight: 21, marginTop: tokens.space[3] },
  spinner: { marginVertical: tokens.space[3] },
  package: {
    minHeight: tokens.minTap,
    backgroundColor: tokens.color.surface,
    borderRadius: 8,
    padding: tokens.space[4],
    marginTop: tokens.space[3],
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dim: { opacity: 0.5 },
  packageName: { color: tokens.color.text, fontSize: 18, fontWeight: '600' },
  price: { color: tokens.color.accent, fontSize: 18, fontWeight: '700' },
  secondary: { minHeight: tokens.minTap, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[2] },
  secondaryText: { color: tokens.color.accent, fontSize: 16 },
});
