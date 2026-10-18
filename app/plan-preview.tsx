import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Href, useRouter } from 'expo-router';
import { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { loadPlanBundle, PlanBundle } from '../src/plan/planData';
import { markPreviewSeen } from '../src/plan/previewSeen';

export default function PlanPreviewScreen() {
  useLanguage();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const [bundle, setBundle] = useState<PlanBundle | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    loadPlanBundle(userId)
      .then((loaded) => alive && setBundle(loaded))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [userId]);

  const start = async () => {
    if (userId) await markPreviewSeen(userId);
    // Back to Today, which opened this screen; replacing would stack a second set of tabs.
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/today' as Href);
  };

  if (!bundle) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.color.accent} size="large" />
      </View>
    );
  }

  const firstWeek = bundle.days.slice(0, 7);
  const first = bundle.days[0];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('preview.title')}</Text>
      <Text style={styles.meta}>{t('preview.intro')}</Text>

      <Text style={styles.heading}>{t('preview.firstWeek')}</Text>
      {firstWeek.map((day) => (
        <View key={day.dayNumber} style={styles.dayRow}>
          <Text style={styles.listItem}>{`${t('today.day')} ${day.dayNumber}`}</Text>
          <Text style={day.workout.kind === 'workout' ? styles.workoutTag : styles.meta}>
            {t(day.workout.kind === 'workout' ? 'preview.workout' : 'preview.rest')}
          </Text>
        </View>
      ))}

      <Text style={styles.heading}>{t('preview.targets')}</Text>
      {first?.calorieTarget != null ? (
        <Text style={styles.listItem}>{`${t('today.calories')}: ${first.calorieTarget} ${t('today.kcal')}`}</Text>
      ) : (
        <Text style={styles.meta}>{t('today.noCalories')}</Text>
      )}
      {first?.proteinTargetG != null ? <Text style={styles.listItem}>{`${t('today.protein')}: ${first.proteinTargetG} g`}</Text> : null}
      <Text style={styles.disclaimer}>{t('health.disclaimer')}</Text>

      <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={start}>
        <Text style={styles.buttonText}>{t('preview.start')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const MUTED = tokens.color.textSecondary;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[5], paddingTop: tokens.space[7] },
  center: { flex: 1, backgroundColor: tokens.color.bg, alignItems: 'center', justifyContent: 'center' },
  title: { color: tokens.color.text, fontSize: 28, fontWeight: '700', marginBottom: tokens.space[3] },
  heading: { color: tokens.color.text, fontSize: 18, fontWeight: '600', marginTop: tokens.space[5], marginBottom: tokens.space[2] },
  meta: { color: MUTED, fontSize: 14, lineHeight: 20 },
  listItem: { color: tokens.color.text, fontSize: 16, marginTop: tokens.space[1] },
  workoutTag: { color: tokens.color.accent, fontSize: 14, fontWeight: '600' },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: tokens.space[1] },
  disclaimer: { color: MUTED, fontSize: 12, marginTop: tokens.space[3], lineHeight: 17 },
  button: { minHeight: tokens.minTap, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[5], backgroundColor: tokens.color.accent },
  buttonText: { color: tokens.color.bg, fontWeight: '600', fontSize: 16 },
});
