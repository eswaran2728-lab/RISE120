import React, { useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Href, useRouter } from 'expo-router';
import { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { BarcodeLookupError, BarcodeOutcome, isValidBarcode, lookupBarcode } from '../src/food/barcode';

type View_ = { kind: 'scanning' } | { kind: 'lookup' } | { kind: 'result'; outcome: BarcodeOutcome } | { kind: 'error'; message: string };

const round1 = (n: number) => Math.round(n * 10) / 10;

const errorKey = (error: unknown): string => {
  if (error instanceof BarcodeLookupError) {
    if (error.code === 'rate_limited') return 'food.scan.rateLimited';
    if (error.code === 'not_configured') return 'food.scan.notConfigured';
    if (error.code === 'offline') return 'food.scan.offline';
  }
  return 'food.scan.unavailable';
};

// Read-only Open Food Facts lookup. The product is shown for information with its source; it is not
// stored and cannot be logged until the owner approves a reuse approach.
export default function FoodScanScreen() {
  useLanguage();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [view, setView] = useState<View_>({ kind: 'scanning' });
  const busy = useRef(false); // one lookup at a time; the camera keeps firing while a code is in view

  const onScanned = async ({ data }: { data: string }) => {
    if (busy.current || !isValidBarcode(data)) return;
    busy.current = true;
    setView({ kind: 'lookup' });
    try {
      setView({ kind: 'result', outcome: await lookupBarcode(data) });
    } catch (error) {
      setView({ kind: 'error', message: t(errorKey(error)) });
    }
  };

  const scanAgain = () => {
    busy.current = false;
    setView({ kind: 'scanning' });
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.color.accent} size="large" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{t('food.scan.title')}</Text>
        <Text style={styles.message}>{t(permission.canAskAgain ? 'food.scan.permissionBody' : 'food.scan.blocked')}</Text>
        {permission.canAskAgain ? (
          <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => void requestPermission()}>
            <Text style={styles.buttonText}>{t('food.scan.allow')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => void Linking.openSettings()}>
            <Text style={styles.buttonText}>{t('food.scan.openSettings')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity accessibilityRole="button" style={styles.link} onPress={() => router.push('/food-edit' as Href)}>
          <Text style={styles.linkText}>{t('food.search.addOwn')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (view.kind === 'scanning' || view.kind === 'lookup') {
    return (
      <View style={styles.container}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a'] }}
          onBarcodeScanned={view.kind === 'scanning' ? (event) => void onScanned(event) : undefined}
        />
        <View style={styles.overlay}>
          {view.kind === 'lookup' ? (
            <>
              <ActivityIndicator color={tokens.color.accent} />
              <Text style={styles.overlayText}>{t('food.scan.lookingUp')}</Text>
            </>
          ) : (
            <Text style={styles.overlayText}>{t('food.scan.hint')}</Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {view.kind === 'error' ? (
        <Text style={styles.message}>{view.message}</Text>
      ) : !view.outcome.found ? (
        <Text style={styles.message}>{t('food.scan.notFound')}</Text>
      ) : !view.outcome.complete ? (
        <>
          {view.outcome.name ? <Text style={styles.name}>{view.outcome.name}</Text> : null}
          <Text style={styles.message}>{t('food.scan.incomplete')}</Text>
        </>
      ) : (
        <View style={styles.card}>
          <Text style={styles.name}>{view.outcome.product.name}</Text>
          {view.outcome.product.brand ? <Text style={styles.meta}>{view.outcome.product.brand}</Text> : null}
          <Text style={styles.meta}>{`${t('food.scan.per')}: ${view.outcome.product.servingDesc}`}</Text>
          <Text style={styles.nutrition}>
            {`${round1(view.outcome.product.calories)} ${t('today.kcal')} · ${t('food.protein')} ${round1(view.outcome.product.proteinG)} g · ${t('food.carbs')} ${round1(view.outcome.product.carbsG)} g · ${t('food.fat')} ${round1(view.outcome.product.fatG)} g`}
          </Text>
          <Text style={styles.meta}>{t('food.scan.source')}</Text>
          <Text style={styles.meta}>{t('food.scan.attribution')}</Text>
          <Text style={styles.warning}>{t('food.scan.loggingOff')}</Text>
        </View>
      )}

      <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={scanAgain}>
        <Text style={styles.buttonText}>{t('food.scan.scanAgain')}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={styles.link} onPress={() => router.push('/food-edit' as Href)}>
        <Text style={styles.linkText}>{t('food.search.addOwn')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const MUTED = '#8892A0';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[5], paddingTop: tokens.space[7], paddingBottom: tokens.space[7] },
  center: { flex: 1, backgroundColor: tokens.color.bg, alignItems: 'center', justifyContent: 'center', padding: tokens.space[5], gap: tokens.space[3] },
  title: { color: tokens.color.text, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  message: { color: tokens.color.text, fontSize: 16, textAlign: 'center', lineHeight: 22, marginBottom: tokens.space[3] },
  overlay: { position: 'absolute', bottom: tokens.space[7], left: tokens.space[5], right: tokens.space[5], alignItems: 'center', backgroundColor: 'rgba(16,19,24,0.8)', borderRadius: 8, padding: tokens.space[4], gap: tokens.space[2] },
  overlayText: { color: tokens.color.text, fontSize: 16, textAlign: 'center' },
  card: { backgroundColor: tokens.color.surface, borderRadius: 8, padding: tokens.space[4], marginBottom: tokens.space[3] },
  name: { color: tokens.color.text, fontSize: 20, fontWeight: '700' },
  meta: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: tokens.space[1] },
  nutrition: { color: tokens.color.text, fontSize: 14, marginTop: tokens.space[2], lineHeight: 20 },
  warning: { color: tokens.color.accent, fontSize: 13, marginTop: tokens.space[3], lineHeight: 18 },
  button: { minHeight: tokens.minTap, minWidth: 200, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.color.accent, paddingHorizontal: tokens.space[4], marginTop: tokens.space[2] },
  buttonText: { color: tokens.color.bg, fontWeight: '600', fontSize: 16 },
  link: { minHeight: tokens.minTap, justifyContent: 'center', alignItems: 'center' },
  linkText: { color: tokens.color.accent, fontSize: 16 },
});
