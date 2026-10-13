import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { t } from '../../src/i18n';
import { useLanguage } from '../../src/i18n/useLanguage';
import { tokens } from '../../src/theme/tokens';
import { useSession } from '../../src/auth/useSession';
import { useLocalDate } from '../../src/lib/useLocalDate';
import { loadUnits } from '../../src/profile/cache';
import { lbFromKg } from '../../src/onboarding/units';
import { getPhotoUrl } from '../../src/checkin/photos';
import { loadProgress } from '../../src/progress/load';
import { deriveProgress, ProgressState } from '../../src/progress/selectors';
import { planPhase } from '../../src/today/selectors';
import { WeightChart } from '../../src/ui/WeightChart';

const COLUMNS = 10;
const round1 = (n: number) => Math.round(n * 10) / 10;

export default function ProgressScreen() {
  useLanguage();
  const { session } = useSession();
  const { width } = useWindowDimensions();
  const userId = session?.user?.id;
  const today = useLocalDate();
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [planComplete, setPlanComplete] = useState(false);
  const [units, setUnits] = useState<'metric' | 'imperial'>('metric');
  const [urls, setUrls] = useState<Record<string, string | null>>({});

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let alive = true;
      (async () => {
        try {
          const input = await loadProgress(userId, today);
          const knownUnits = await loadUnits(userId);
          if (!alive) return;
          setUnits(knownUnits);
          setProgress(input ? deriveProgress(input) : null);
          setPlanComplete(input ? planPhase(input.plan, today) === 'complete' : false);
        } catch {
          if (alive) setProgress(null);
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [userId, today])
  );

  // Private photos are read through short-lived signed URLs.
  useEffect(() => {
    if (!progress) return;
    let alive = true;
    for (const photo of progress.photos) {
      if (!photo.path) continue;
      const path = photo.path;
      getPhotoUrl(path).then((url) => alive && setUrls((current) => ({ ...current, [path]: url })));
    }
    return () => {
      alive = false;
    };
  }, [progress]);

  const formatWeight = (kg: number) => (units === 'imperial' ? `${round1(lbFromKg(kg))} lb` : `${kg} kg`);
  const contentWidth = width - 2 * tokens.space[5];
  const cell = Math.floor((contentWidth - (COLUMNS - 1) * 4) / COLUMNS);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.color.accent} size="large" />
      </View>
    );
  }

  if (!progress) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{t('workout.noPlan')}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('progress.title')}</Text>
      {planComplete ? <Text style={styles.completeBanner}>{t('today.planComplete')}</Text> : null}

      <Text style={styles.heading}>{t('progress.weight')}</Text>
      {progress.weightPoints.length === 0 ? (
        <Text style={styles.meta}>{t('progress.noWeights')}</Text>
      ) : (
        <WeightChart points={progress.weightPoints} width={contentWidth} formatWeight={formatWeight} label={t('progress.chartLabel')} />
      )}

      <Text style={styles.heading}>{t('progress.photos')}</Text>
      {progress.photos.length === 0 ? (
        <Text style={styles.meta}>{t('progress.noPhotos')}</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {progress.photos.map((photo) => {
            const uri = photo.localUri ?? (photo.path ? urls[photo.path] : null);
            return (
              <View key={`${photo.date}-${photo.path ?? 'local'}`} style={styles.photoBox}>
                {uri ? <Image source={{ uri }} style={styles.photo} accessibilityLabel={photo.date} /> : <View style={[styles.photo, styles.photoLoading]} />}
                <Text style={styles.meta}>{photo.date}</Text>
                {photo.pending ? <Text style={styles.pendingText}>{t('workout.pending')}</Text> : null}
              </View>
            );
          })}
        </ScrollView>
      )}

      <Text style={styles.heading}>{t('progress.calendar')}</Text>
      <View style={styles.grid}>
        {progress.calendar.map((c) => (
          <View
            key={c.dayNumber}
            accessible
            accessibilityLabel={`${t('today.day')} ${c.dayNumber}: ${t(`progress.state.${c.state}`)}${c.pending ? `, ${t('workout.pending')}` : ''}`}
            style={[
              styles.cell,
              { width: cell, height: cell },
              c.state === 'complete' && styles.cellComplete,
              c.state === 'partial' && styles.cellPartial,
              c.state === 'missed' && styles.cellMissed,
              c.isToday && styles.cellToday,
            ]}
          >
            {c.pending ? <View style={styles.pendingDot} /> : null}
          </View>
        ))}
      </View>
      <Text style={styles.meta}>{t('progress.legend')}</Text>

      <Text style={styles.heading}>{t('progress.history')}</Text>
      {progress.history.length === 0 ? <Text style={styles.meta}>{t('progress.noHistory')}</Text> : null}
      {progress.history.map((entry) => (
        <View key={entry.date} style={styles.historyRow}>
          <Text style={styles.listItem}>{entry.date}</Text>
          <Text style={styles.meta}>
            {[
              entry.weightKg !== null ? formatWeight(entry.weightKg) : null,
              entry.mood !== null ? `${t('progress.mood')} ${entry.mood}/5` : null,
              entry.sleepHours !== null ? `${t('progress.sleep')} ${entry.sleepHours}${t('progress.hoursShort')}` : null,
            ]
              .filter(Boolean)
              .join('  ·  ')}
          </Text>
          {entry.pending ? <Text style={styles.pendingText}>{t('workout.pending')}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}

const MUTED = '#8892A0';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[5], paddingTop: tokens.space[7], paddingBottom: tokens.space[7] },
  center: { flex: 1, backgroundColor: tokens.color.bg, alignItems: 'center', justifyContent: 'center', padding: tokens.space[5] },
  message: { color: tokens.color.text, fontSize: 18, textAlign: 'center' },
  title: { color: tokens.color.text, fontSize: 28, fontWeight: '700' },
  completeBanner: { color: tokens.color.accent, fontSize: 16, fontWeight: '600', marginTop: tokens.space[2] },
  heading: { color: tokens.color.text, fontSize: 18, fontWeight: '600', marginTop: tokens.space[5], marginBottom: tokens.space[2] },
  meta: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: tokens.space[1] },
  listItem: { color: tokens.color.text, fontSize: 16 },
  pendingText: { color: tokens.color.accent, fontSize: 12, marginTop: 2 },
  photoBox: { marginRight: tokens.space[3], alignItems: 'center' },
  photo: { width: 96, height: 128, borderRadius: 8, backgroundColor: tokens.color.surface },
  photoLoading: { opacity: 0.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  cell: { borderRadius: 4, backgroundColor: tokens.color.surface, alignItems: 'center', justifyContent: 'center' },
  cellComplete: { backgroundColor: tokens.color.accent },
  cellPartial: { backgroundColor: tokens.color.surface, borderWidth: 2, borderColor: tokens.color.accent },
  cellMissed: { backgroundColor: '#2D3748' },
  cellToday: { borderWidth: 2, borderColor: tokens.color.text },
  pendingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.color.bg, borderWidth: 1, borderColor: tokens.color.text },
  historyRow: { paddingVertical: tokens.space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2D3748' },
});
