import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Href, useFocusEffect, useRouter } from 'expo-router';
import { t } from '../../src/i18n';
import { useLanguage } from '../../src/i18n/useLanguage';
import { tokens } from '../../src/theme/tokens';
import { useSession } from '../../src/auth/useSession';
import { useLocalDate } from '../../src/lib/useLocalDate';
import { JourneyArc } from '../../src/ui/JourneyArc';
import { ensurePlan } from '../../src/plan/ensurePlan';
import { generatePlan } from '../../src/plan/generatePlan';
import { loadPlanBundle } from '../../src/plan/planData';
import { hasSeenPreview } from '../../src/plan/previewSeen';
import { loadCheckin } from '../../src/checkin/load';
import { loadCheckinDates } from '../../src/today/load';
import { checkinStreak, deriveToday, getPlanDay, PLAN_LENGTH, planPhase, TodayState } from '../../src/today/selectors';
import { loadSessionSets } from '../../src/workout/session';
import { LimitNotice } from '../../src/ui/LimitNotice';
import { useUnlock } from '../../src/monetization/useUnlock';
import { LimitSnapshot, loadLimitsOrCached, lockedPlanDay, unlockActions } from '../../src/monetization/limits';
import { withAccountKey } from '../../src/auth/withAccountKey';

type Status = 'loading' | 'creating' | 'error' | 'ready';

function TodayScreen() {
  useLanguage();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const [status, setStatus] = useState<Status>('loading');
  const [today, setToday] = useState<TodayState | null>(null);
  const [streak, setStreak] = useState(0);
  const [workoutNames, setWorkoutNames] = useState<string[]>([]);
  const [planComplete, setPlanComplete] = useState(false);
  // Set when today's plan day lies past what the server lets this account open (the free plan days).
  const [locked, setLocked] = useState<{ dayNumber: number; snapshot: LimitSnapshot | null; checkinDone: boolean } | null>(null);
  const mounted = useRef(true);
  const date = useLocalDate(); // rolls over at midnight and on resume, then the screen reloads
  const unlock = useUnlock({ rewardType: 'food' });

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

      setPlanComplete(planPhase(bundle.plan, date) === 'complete');
      const day = getPlanDay(bundle.plan, bundle.days, date);
      const sessionSets = await loadSessionSets(userId, date);
      const checkin = await loadCheckin(userId, date);
      const dates = await loadCheckinDates(userId);
      if (!alive()) return;

      setStreak(checkinStreak(dates, date));
      const limitResult = day ? null : await loadLimitsOrCached(userId);
      if (!alive()) return;
      const lockedDay = day ? null : lockedPlanDay(bundle.plan, date, limitResult?.snapshot ?? null);
      setLocked(lockedDay === null ? null : { dayNumber: lockedDay, snapshot: limitResult?.snapshot ?? null, checkinDone: checkin !== null });
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

  const settingsButton = (style: object) => (
    <TouchableOpacity testID="today-settings" accessibilityRole="button" style={style} onPress={() => router.push('/settings' as Href)}>
      <Text style={styles.settingsText}>{t('settings.title')}</Text>
    </TouchableOpacity>
  );
  const settingsLink = settingsButton(styles.settingsLink);

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

  if (planComplete) {
    return (
      <View style={styles.center}>
        <Text style={styles.completeTitle}>{t('today.planComplete')}</Text>
        <Text style={styles.message}>{t('today.planCompleteBody')}</Text>
        {settingsLink}
      </View>
    );
  }

  if (!today && locked) {
    // Workouts, check-ins and food logging stay available; only the plan day itself is locked.
    return (
      <View style={styles.container}>
        {settingsLink}
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{t('today.dayOfTotal', { day: locked.dayNumber, total: PLAN_LENGTH })}</Text>
          <LimitNotice title={t('limits.planLocked')} body={t('limits.planLockedBody')} actions={unlockActions(locked.snapshot, 'plan')} onAction={unlock.run} />
          <TouchableOpacity testID="today-log-food" accessibilityRole="button" style={styles.linkButton} onPress={() => router.navigate('/(tabs)/food' as Href)}>
            <Text style={styles.linkText}>{t('today.logFood')}</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="today-checkin" accessibilityRole="button" style={styles.button} onPress={() => router.push('/checkin' as Href)}>
            <Text style={styles.buttonText}>{t(locked.checkinDone ? 'today.checkinDone' : 'today.checkin')}</Text>
          </TouchableOpacity>
        </ScrollView>
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

  const rest = today.kind === 'rest';
  const workoutFinished = !rest && today.plannedSets > 0 && today.completedSets >= today.plannedSets;
  const workoutStarted = !rest && today.completedSets > 0 && !workoutFinished;
  const workoutActionKey = workoutFinished ? 'today.viewWorkout' : workoutStarted ? 'today.resumeWorkout' : 'today.startWorkout';
  const setsText = t('today.setsProgress', { done: today.completedSets, total: today.plannedSets });
  const checkinText = t(today.checkinDone ? 'today.checkinDone' : 'today.checkin');
  const journeyDay = today.dayNumber; // the calendar day; finishing tasks never moves it

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.brand}>{t('today.brand')}</Text>
          {settingsButton(styles.settingsInline)}
        </View>

        <JourneyArc
          day={journeyDay}
          total={PLAN_LENGTH}
          label={t('today.journeyLabel', { day: journeyDay, total: PLAN_LENGTH })}
          dayText={t('today.dayOfTotal', { day: journeyDay, total: PLAN_LENGTH })}
          caption={t('today.journeyCaption')}
        />
        <Text style={styles.streak}>{`${streak} ${t('today.streak')}`}</Text>

        <View testID="today-session-card" style={styles.sessionCard}>
          <Text style={styles.sessionEyebrow}>{t('today.yourSession')}</Text>
          <Text style={styles.sessionTitle}>{t(rest ? 'today.stepWorkout' : 'today.workoutTitle')}</Text>
          {rest ? (
            <Text style={styles.sessionBody}>{t('today.restDay')}</Text>
          ) : (
            <>
              <Text style={styles.sessionBody}>{`${workoutNames.length} ${t('today.exercises')} · ${workoutFinished ? t('today.workoutComplete') : setsText}`}</Text>
              {workoutNames.map((name) => (
                <Text key={name} style={styles.sessionItem}>{name}</Text>
              ))}
            </>
          )}
          <TouchableOpacity
            testID="today-primary-action"
            accessibilityRole="button"
            style={styles.sessionButton}
            onPress={() => (rest ? router.push('/checkin' as Href) : router.navigate('/(tabs)/workout' as Href))}
          >
            <Text style={styles.sessionButtonText}>{rest ? checkinText : t(workoutActionKey)}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('today.stepsTitle')}</Text>
          <View testID="today-step-workout" style={styles.stepRow}>
            <Text style={styles.stepName}>{t('today.stepWorkout')}</Text>
            <Text style={styles.stepStatus}>{rest ? t('today.statusRest') : workoutFinished ? t('today.statusDone') : setsText}</Text>
          </View>
          <View testID="today-step-checkin" style={styles.stepRow}>
            <Text style={styles.stepName}>{t('today.stepCheckin')}</Text>
            <Text style={styles.stepStatus}>{t(today.checkinDone ? 'today.statusDone' : 'today.statusOpen')}</Text>
          </View>
          {rest ? null : (
            <TouchableOpacity testID="today-checkin" accessibilityRole="button" style={styles.secondaryButton} onPress={() => router.push('/checkin' as Href)}>
              <Text style={styles.secondaryButtonText}>{checkinText}</Text>
            </TouchableOpacity>
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
          <TouchableOpacity testID="today-log-food" accessibilityRole="button" style={styles.linkButton} onPress={() => router.navigate('/(tabs)/food' as Href)}>
            <Text style={styles.linkText}>{t('today.logFood')}</Text>
          </TouchableOpacity>
          <Text style={styles.disclaimer}>{t('health.disclaimer')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[4], paddingTop: tokens.space[6], paddingBottom: tokens.space[6] },
  center: { flex: 1, backgroundColor: tokens.color.bg, alignItems: 'center', justifyContent: 'center', padding: tokens.space[5], gap: tokens.space[3] },
  message: { color: tokens.color.text, fontSize: 18, lineHeight: 27, textAlign: 'center' },
  completeTitle: { color: tokens.color.accent, fontSize: 26, fontWeight: '700', textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: tokens.space[3] },
  brand: { color: tokens.color.text, fontSize: 28, fontWeight: '800' },
  settingsLink: { position: 'absolute', top: tokens.space[7], right: tokens.space[5], minHeight: tokens.minTap, justifyContent: 'center', zIndex: 1 },
  settingsInline: { minHeight: tokens.minTap, minWidth: tokens.minTap, justifyContent: 'center', alignItems: 'flex-end' },
  settingsText: { color: tokens.color.accent, fontSize: 16, lineHeight: 24 },
  title: { color: tokens.color.text, fontSize: 28, fontWeight: '700', marginTop: tokens.space[7], marginBottom: tokens.space[4] },
  streak: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: tokens.space[4] },
  sessionCard: { backgroundColor: tokens.color.accent, borderRadius: tokens.radius.card, padding: tokens.space[4], marginBottom: tokens.space[4] },
  sessionEyebrow: { color: tokens.color.onAccent, fontSize: 14, lineHeight: 21, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  sessionTitle: { color: tokens.color.onAccent, fontSize: 24, lineHeight: 32, fontWeight: '800', marginTop: tokens.space[1] },
  sessionBody: { color: tokens.color.onAccent, fontSize: 16, lineHeight: 24, marginTop: tokens.space[1] },
  sessionItem: { color: tokens.color.onAccent, fontSize: 16, lineHeight: 24, marginTop: tokens.space[1] },
  sessionButton: { minHeight: tokens.minTap, borderRadius: tokens.radius.control, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[4], backgroundColor: tokens.color.onAccent, paddingHorizontal: tokens.space[4] },
  sessionButtonText: { color: tokens.color.accent, fontWeight: '700', fontSize: 16, lineHeight: 24, textAlign: 'center' },
  card: { backgroundColor: tokens.color.surface, borderColor: tokens.color.border, borderWidth: 1, borderRadius: tokens.radius.card, padding: tokens.space[4], marginBottom: tokens.space[4] },
  cardTitle: { color: tokens.color.text, fontSize: 18, lineHeight: 27, fontWeight: '600', marginBottom: tokens.space[1] },
  stepRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: tokens.space[3], paddingVertical: tokens.space[1] },
  stepName: { flexShrink: 1, color: tokens.color.text, fontSize: 16, lineHeight: 24 },
  stepStatus: { flexShrink: 1, color: tokens.color.textSecondary, fontSize: 16, lineHeight: 24, textAlign: 'right' },
  meta: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21 },
  listItem: { color: tokens.color.text, fontSize: 16, lineHeight: 24, marginTop: tokens.space[1] },
  disclaimer: { color: tokens.color.textSecondary, fontSize: 14, marginTop: tokens.space[3], lineHeight: 21 },
  button: { minHeight: tokens.minTap, borderRadius: tokens.radius.control, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[3], backgroundColor: tokens.color.accent, paddingHorizontal: tokens.space[4] },
  buttonText: { color: tokens.color.onAccent, fontWeight: '600', fontSize: 16, lineHeight: 24, textAlign: 'center' },
  secondaryButton: { minHeight: tokens.minTap, borderRadius: tokens.radius.control, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[3], borderWidth: 1, borderColor: tokens.color.borderStrong, paddingHorizontal: tokens.space[4] },
  secondaryButtonText: { color: tokens.color.text, fontWeight: '600', fontSize: 16, lineHeight: 24, textAlign: 'center' },
  linkButton: { minHeight: tokens.minTap, justifyContent: 'center' },
  linkText: { color: tokens.color.accent, fontSize: 16, lineHeight: 24 },
});

export default withAccountKey(TodayScreen);
