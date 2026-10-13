import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Href, useFocusEffect, useRouter } from 'expo-router';
import { t } from '../../src/i18n';
import { useLanguage } from '../../src/i18n/useLanguage';
import { tokens } from '../../src/theme/tokens';
import { useSession } from '../../src/auth/useSession';
import { useLocalDate } from '../../src/lib/useLocalDate';
import { ProgressRing } from '../../src/ui/ProgressRing';
import { ensurePlan } from '../../src/plan/ensurePlan';
import { generatePlan } from '../../src/plan/generatePlan';
import { loadPlanBundle } from '../../src/plan/planData';
import { hasSeenPreview } from '../../src/plan/previewSeen';
import { loadCheckin } from '../../src/checkin/load';
import { loadCheckinDates } from '../../src/today/load';
import { checkinStreak, deriveToday, getPlanDay, PLAN_LENGTH, TodayState } from '../../src/today/selectors';
import { loadSessionSets } from '../../src/workout/session';

type Status = 'loading' | 'creating' | 'error' | 'ready';

export default function TodayScreen() {
  useLanguage();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const [status, setStatus] = useState<Status>('loading');
  const [today, setToday] = useState<TodayState | null>(null);
  const [streak, setStreak] = useState(0);
  const [workoutNames, setWorkoutNames] = useState<string[]>([]);
  const mounted = useRef(true);
  const date = useLocalDate(); // rolls over at midnight and on resume, then the screen reloads

  const load = useCallback(async () => {
    if (!userId) return;
    const alive = () => mounted.current;
    try {
      setStatus((current) => (current === 'ready' ? current : 'loading'));
      const { bundle, created } = await ensurePlan({
        load: () => loadPlanBundle(userId),
        generate: async (startDate) => {
          if (alive()) setStatus('creating');
          await generatePlan(startDate);
        },
        today: () => date,
      });
      if (!alive()) return;
      if (created || !(await hasSeenPreview(userId))) {
        router.push('/plan-preview' as Href);
      }

      const day = getPlanDay(bundle.plan, bundle.days, date);
      const sessionSets = await loadSessionSets(userId, date);
      const checkin = await loadCheckin(userId, date);
      const dates = await loadCheckinDates(userId);
      if (!alive()) return;

      setStreak(checkinStreak(dates, date));
      if (day) {
        setToday(deriveToday(day, sessionSets, checkin !== null));
        setWorkoutNames(
          day.workout.kind === 'workout'
            ? day.workout.exercises.map((e) => bundle.exercises.find((x) => x.id === e.exercise_id)?.name ?? '')
            : []
        );
      } else {
        setToday(null);
      }
      setStatus('ready');
    } catch {
      if (alive()) setStatus('error');
    }
  }, [userId, router, date]);

  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      void load();
      return () => {
        mounted.current = false;
      };
    }, [load])
  );

  const settingsLink = (
    <TouchableOpacity accessibilityRole="button" style={styles.settingsLink} onPress={() => router.push('/settings' as Href)}>
      <Text style={styles.settingsText}>{t('settings.title')}</Text>
    </TouchableOpacity>
  );

  if (status === 'loading' || status === 'creating') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.color.accent} size="large" />
        {status === 'creating' ? <Text style={styles.message}>{t('today.creating')}</Text> : null}
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{t('today.planError')}</Text>
        <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => void load()}>
          <Text style={styles.buttonText}>{t('errors.retry')}</Text>
        </TouchableOpacity>
        {settingsLink}
      </View>
    );
  }

  if (!today) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{t('today.noDay')}</Text>
        {settingsLink}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {settingsLink}
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{`${t('today.day')} ${today.dayNumber} / ${PLAN_LENGTH}`}</Text>

        <View style={styles.ringRow}>
          <ProgressRing progress={today.ringProgress} label={t('today.day')} />
          <View style={styles.streakBox}>
            <Text style={styles.streakNumber}>{streak}</Text>
            <Text style={styles.meta}>{t('today.streak')}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('today.workoutTitle')}</Text>
          {today.kind === 'rest' ? (
            <Text style={styles.meta}>{t('today.restDay')}</Text>
          ) : (
            <>
              <Text style={styles.meta}>{`${workoutNames.length} ${t('today.exercises')} · ${today.completedSets}/${today.plannedSets} ${t('today.setsDone')}`}</Text>
              {workoutNames.map((name) => (
                <Text key={name} style={styles.listItem}>{name}</Text>
              ))}
              <TouchableOpacity accessibilityRole="button" style={styles.linkButton} onPress={() => router.navigate('/(tabs)/workout' as Href)}>
                <Text style={styles.linkText}>{t('today.openWorkout')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('preview.targets')}</Text>
          {today.calorieTarget === null ? (
            <Text style={styles.meta}>{t('today.noCalories')}</Text>
          ) : (
            <Text style={styles.listItem}>{`${t('today.calories')}: ${today.calorieTarget} ${t('today.kcal')}`}</Text>
          )}
          {today.proteinTargetG !== null ? <Text style={styles.listItem}>{`${t('today.protein')}: ${today.proteinTargetG} g`}</Text> : null}
          <Text style={styles.disclaimer}>{t('health.disclaimer')}</Text>
        </View>

        <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => router.push('/checkin' as Href)}>
          <Text style={styles.buttonText}>{t(today.checkinDone ? 'today.checkinDone' : 'today.checkin')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const MUTED = '#8892A0';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[5], paddingTop: tokens.space[7] + tokens.minTap },
  center: { flex: 1, backgroundColor: tokens.color.bg, alignItems: 'center', justifyContent: 'center', padding: tokens.space[5], gap: tokens.space[3] },
  message: { color: tokens.color.text, fontSize: 18, textAlign: 'center' },
  settingsLink: { position: 'absolute', top: tokens.space[7], right: tokens.space[5], minHeight: tokens.minTap, justifyContent: 'center', zIndex: 1 },
  settingsText: { color: tokens.color.accent, fontSize: 16 },
  title: { color: tokens.color.text, fontSize: 28, fontWeight: '700', marginBottom: tokens.space[4] },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[5], marginBottom: tokens.space[4] },
  streakBox: { alignItems: 'center' },
  streakNumber: { color: tokens.color.accent, fontSize: 40, fontWeight: '700' },
  card: { backgroundColor: tokens.color.surface, borderRadius: 8, padding: tokens.space[4], marginBottom: tokens.space[3] },
  cardTitle: { color: tokens.color.text, fontSize: 18, fontWeight: '600', marginBottom: tokens.space[1] },
  meta: { color: MUTED, fontSize: 14, lineHeight: 20 },
  listItem: { color: tokens.color.text, fontSize: 16, marginTop: tokens.space[1] },
  disclaimer: { color: MUTED, fontSize: 12, marginTop: tokens.space[3], lineHeight: 17 },
  button: { minHeight: tokens.minTap, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[3], backgroundColor: tokens.color.accent, paddingHorizontal: tokens.space[4] },
  buttonText: { color: tokens.color.bg, fontWeight: '600', fontSize: 16, textAlign: 'center' },
  linkButton: { minHeight: tokens.minTap, justifyContent: 'center' },
  linkText: { color: tokens.color.accent, fontSize: 16 },
});
