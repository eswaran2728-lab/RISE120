import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { loadLimitsOrCached } from '../src/monetization/limits';
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

export default function PaywallScreen() {
  useLanguage();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const [offer, setOffer] = useState<OfferResult | null>(null);
  const [premium, setPremium] = useState(false);
  const [busy, setBusy] = useState(false);
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    if (!userId) return;
    // Premium is whatever the server says; the store sheet below never decides it.
    const [result, limits] = await Promise.all([getPurchaseService().loadOffer(), loadLimitsOrCached(userId)]);
    if (!mounted.current) return;
    setPremium(limits?.snapshot.tier === 'premium');
    setOffer(result);
  }, [userId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const refreshPremium = async () => {
    if (!userId) return;
    const limits = await loadLimitsOrCached(userId);
    if (mounted.current) setPremium(limits?.snapshot.tier === 'premium' && !limits.stale);
  };

  const buy = async (pkg: StorePackage) => {
    if (!userId || busy) return;
    setBusy(true);
    setMessageKey(null);
    const result = await getPurchaseService().purchase(userId, pkg).catch(() => 'failed' as const);
    if (!mounted.current) return;
    setMessageKey(PURCHASE_MESSAGES[result]);
    if (result === 'premium') await refreshPremium();
    if (mounted.current) setBusy(false);
  };

  const restore = async () => {
    if (!userId || busy) return;
    setBusy(true);
    setMessageKey(null);
    const result = await getPurchaseService().restore(userId).catch(() => 'failed' as const);
    if (!mounted.current) return;
    setMessageKey(RESTORE_MESSAGES[result]);
    if (result === 'premium') await refreshPremium();
    if (mounted.current) setBusy(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('paywall.title')}</Text>
      <Text style={styles.body}>{t('paywall.body')}</Text>

      {premium ? <Text style={styles.success}>{t('paywall.premiumActive')}</Text> : null}

      {!premium && offer === null ? <ActivityIndicator color={tokens.color.accent} style={styles.spinner} /> : null}
      {!premium && offer?.status === 'not_configured' ? <Text style={styles.meta}>{t('paywall.notConfigured')}</Text> : null}
      {!premium && offer?.status === 'unavailable' ? (
        <>
          <Text style={styles.meta}>{t('paywall.unavailable')}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.secondary} onPress={() => {
              setOffer(null);
              void load();
            }}>
            <Text style={styles.secondaryText}>{t('errors.retry')}</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {!premium && offer?.status === 'ready'
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

      {messageKey ? <Text style={styles.message}>{t(messageKey)}</Text> : null}
      {busy ? <ActivityIndicator color={tokens.color.accent} style={styles.spinner} /> : null}

      {!premium && offer && offer.status !== 'not_configured' ? (
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

const MUTED = '#8892A0';

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
