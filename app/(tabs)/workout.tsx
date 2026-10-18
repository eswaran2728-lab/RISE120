import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { t } from '../../src/i18n';
import { useLanguage } from '../../src/i18n/useLanguage';
import { tokens } from '../../src/theme/tokens';
import { useSession } from '../../src/auth/useSession';
import { useLocalDate } from '../../src/lib/useLocalDate';
import { loadUnits } from '../../src/profile/cache';
import { lbFromKg } from '../../src/onboarding/units';
import { loadPlanBundle, PlanBundle } from '../../src/plan/planData';
import { getPlanVersion } from '../../src/plan/planEvents';
import { getPlanDay, planPhase } from '../../src/today/selectors';
import { flushPending } from '../../src/sync/flush';
import { supabaseTransport } from '../../src/sync/supabaseTransport';
import { loadSessionSets } from '../../src/workout/session';
import { LimitNotice } from '../../src/ui/LimitNotice';
import { useUnlock } from '../../src/monetization/useUnlock';
import { LimitSnapshot, loadLimitsOrCached, lockedPlanDay, unlockActions } from '../../src/monetization/limits';
import {
  formatClock,
  nextSetNumber,
  parseSetFields,
  queueWorkoutSet,
  restRemaining,
  SessionSet,
  summarizeSession,
} from '../../src/workout/log';
import { withAccountKey } from '../../src/auth/withAccountKey';

const REST_OPTIONS = [60, 90, 120];
const round1 = (n: number) => Math.round(n * 10) / 10;

function WorkoutScreen() {
  useLanguage();
  const { session } = useSession();
  const userId = session?.user?.id;
  const [loading, setLoading] = useState(true);
  const [bundle, setBundle] = useState<PlanBundle | null>(null);
  const seenPlanVersion = useRef(0); // the plan version the bundle on screen was read at
  const [limits, setLimits] = useState<LimitSnapshot | null>(null);
  const unlock = useUnlock({ rewardType: 'food' });
  const [units, setUnits] = useState<'metric' | 'imperial'>('metric');
  const [sets, setSets] = useState<SessionSet[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null); // `${date}:${exerciseId}`
  const [showHow, setShowHow] = useState(false);
  const [repsText, setRepsText] = useState('');
  const [weightText, setWeightText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rest, setRest] = useState<{ startedAt: number; duration: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [restDuration, setRestDuration] = useState(60);

  // Rolls over at local midnight and on resume. The open exercise form is tied to the date it was
  // opened on, so a set can never be logged under a day the user is not looking at.
  const today = useLocalDate();

  const refreshSets = useCallback(async () => {
    if (!userId) return;
    setSets(await loadSessionSets(userId, today));
  }, [userId, today]);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let alive = true;
      const planVersion = getPlanVersion(userId);
      (async () => {
        try {
          const [planBundle, knownUnits, limitResult] = await Promise.all([
            loadPlanBundle(userId).catch(() => null),
            loadUnits(userId),
            loadLimitsOrCached(userId),
          ]);
          if (!alive) return;
          setLimits(limitResult?.snapshot ?? null);
          // A failed refresh keeps the plan we already have instead of blanking the screen, unless the plan has
          // changed since (a coach proposal was accepted): then the old one is dropped, not shown as current.
          if (planBundle) {
            setBundle(planBundle);
            seenPlanVersion.current = planVersion;
          } else if (planVersion !== seenPlanVersion.current) {
            setBundle(null);
          }
          setUnits(knownUnits);
          await refreshSets();
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [userId, refreshSets])
  );

  // The rest timer is derived from device timestamps; this only re-renders each second.
  useEffect(() => {
    if (!rest) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [rest]);

  const day = bundle ? getPlanDay(bundle.plan, bundle.days, today) : null;
  const exerciseName = (id: string) => bundle?.exercises.find((e) => e.id === id)?.name ?? '';
  const displayWeight = (kg: number) => (units === 'imperial' ? round1(lbFromKg(kg)) : kg);
  const weightUnit = units === 'imperial' ? 'lb' : 'kg';

  const selectedPrefix = `${today}:`;
  const selected = selectedKey?.startsWith(selectedPrefix) ? selectedKey.slice(selectedPrefix.length) : null;

  const logSet = async () => {
    if (!userId || !selected) return;
    const parsed = parseSetFields({ reps: repsText, weight: weightText, units });
    if (!parsed.ok) {
      setError(t(parsed.reason === 'invalid' ? 'onboarding.errors.number' : parsed.reason === 'min' ? 'onboarding.errors.tooLow' : 'onboarding.errors.tooHigh'));
      return;
    }
    setError(null);
    try {
      await queueWorkoutSet(userId, today, {
        exerciseId: selected,
        setNumber: nextSetNumber(sets, selected),
        reps: repsText,
        weight: weightText,
        units,
      });
    } catch {
      setError(t('errors.generic'));
      return;
    }
    await refreshSets();
    setRest({ startedAt: Date.now(), duration: restDuration });
    setNow(Date.now());
    void flushPending(userId, supabaseTransport).then(refreshSets).catch(() => undefined);
  };

  const remaining = rest ? restRemaining(rest.startedAt, now, rest.duration) : 0;
  const summary = summarizeSession(sets);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.color.accent} size="large" />
      </View>
    );
  }

  if (bundle && !day && planPhase(bundle.plan, today) === 'complete') {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{t('today.planComplete')}</Text>
        <Text style={styles.meta}>{t('today.planCompleteBody')}</Text>
      </View>
    );
  }

  if (bundle && !day && lockedPlanDay(bundle.plan, today, limits) !== null) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('workout.title')}</Text>
        <LimitNotice title={t('limits.planLocked')} body={t('limits.planLockedBody')} actions={unlockActions(limits, 'plan')} onAction={unlock.run} />
      </ScrollView>
    );
  }

  if (!bundle || !day) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{t('workout.noPlan')}</Text>
      </View>
    );
  }

  if (day.workout.kind === 'rest') {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{t('workout.restDay')}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('workout.title')}</Text>

      {rest ? (
        <View style={styles.restBox}>
          <Text style={styles.restLabel}>{remaining > 0 ? t('workout.rest') : t('workout.restDone')}</Text>
          {remaining > 0 ? <Text style={styles.restClock}>{formatClock(remaining)}</Text> : null}
          <TouchableOpacity accessibilityRole="button" onPress={() => setRest(null)} style={styles.link}>
            <Text style={styles.linkText}>{t('workout.skipRest')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {day.workout.exercises.map((entry) => {
        const open = selected === entry.exercise_id;
        const done = sets.filter((s) => s.exerciseId === entry.exercise_id);
        const exercise = bundle.exercises.find((e) => e.id === entry.exercise_id);
        return (
          <View key={entry.exercise_id} style={[styles.card, open && styles.cardOpen]}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setSelectedKey(open ? null : `${today}:${entry.exercise_id}`);
                setRepsText(String(entry.reps));
                setWeightText('');
                setError(null);
                setShowHow(false);
              }}
            >
              <Text style={styles.exerciseName}>{exerciseName(entry.exercise_id)}</Text>
              <Text style={styles.meta}>{`${t('workout.plan')}: ${entry.sets} × ${entry.reps}  ·  ${done.length}/${entry.sets}`}</Text>
            </TouchableOpacity>

            {done.map((set) => (
              <Text key={set.id} style={styles.setLine}>
                {`${t('workout.set')} ${set.setNumber}: ${set.reps} × ${displayWeight(set.weightKg)} ${weightUnit}${set.pending ? `  (${t('workout.pending')})` : ''}`}
              </Text>
            ))}

            {open ? (
              <View style={styles.form}>
                <Text style={styles.label}>{t('workout.reps')}</Text>
                <TextInput style={styles.input} value={repsText} onChangeText={setRepsText} keyboardType="number-pad" />
                <Text style={styles.label}>{t(units === 'imperial' ? 'workout.weightLb' : 'workout.weightKg')}</Text>
                <TextInput style={styles.input} value={weightText} onChangeText={setWeightText} keyboardType="decimal-pad" />
                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <View style={styles.row}>
                  {REST_OPTIONS.map((seconds) => (
                    <TouchableOpacity
                      key={seconds}
                      accessibilityRole="button"
                      style={[styles.chip, restDuration === seconds && styles.chipSelected]}
                      onPress={() => setRestDuration(seconds)}
                    >
                      <Text style={[styles.chipText, restDuration === seconds && styles.chipTextSelected]}>{formatClock(seconds)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={logSet}>
                  <Text style={styles.buttonText}>{`${t('workout.logSet')} ${nextSetNumber(sets, entry.exercise_id)}`}</Text>
                </TouchableOpacity>

                <TouchableOpacity accessibilityRole="button" style={styles.link} onPress={() => setShowHow(!showHow)}>
                  <Text style={styles.linkText}>{t(showHow ? 'workout.hideHow' : 'workout.howTo')}</Text>
                </TouchableOpacity>
                {showHow ? <Text style={styles.meta}>{exercise?.instructions}</Text> : null}
              </View>
            ) : null}
          </View>
        );
      })}

      <View style={styles.summary}>
        <Text style={styles.exerciseName}>{t('workout.summary')}</Text>
        <Text style={styles.meta}>{`${t('workout.completedSets')}: ${summary.completedSets}`}</Text>
        <Text style={styles.meta}>{`${t('workout.totalReps')}: ${summary.totalReps}`}</Text>
        <Text style={styles.meta}>{`${t('workout.volume')}: ${displayWeight(summary.volumeKg)} ${weightUnit}`}</Text>
      </View>
    </ScrollView>
  );
}

const MUTED = tokens.color.textSecondary;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[5], paddingTop: tokens.space[7] },
  center: { flex: 1, backgroundColor: tokens.color.bg, alignItems: 'center', justifyContent: 'center', padding: tokens.space[5] },
  message: { color: tokens.color.text, fontSize: 18, textAlign: 'center' },
  title: { color: tokens.color.text, fontSize: 28, fontWeight: '700', marginBottom: tokens.space[4] },
  restBox: { backgroundColor: tokens.color.surface, borderRadius: 8, padding: tokens.space[4], marginBottom: tokens.space[4], alignItems: 'center' },
  restLabel: { color: MUTED, fontSize: 14 },
  restClock: { color: tokens.color.accent, fontSize: 40, fontWeight: '700' },
  card: { backgroundColor: tokens.color.surface, borderRadius: 8, padding: tokens.space[4], marginBottom: tokens.space[3], borderWidth: 1, borderColor: tokens.color.border },
  cardOpen: { borderColor: tokens.color.accent },
  exerciseName: { color: tokens.color.text, fontSize: 18, fontWeight: '600' },
  meta: { color: MUTED, fontSize: 14, marginTop: tokens.space[1], lineHeight: 20 },
  setLine: { color: tokens.color.text, fontSize: 14, marginTop: tokens.space[1] },
  form: { marginTop: tokens.space[3] },
  label: { color: MUTED, fontSize: 14, marginBottom: tokens.space[1], marginTop: tokens.space[2] },
  input: { backgroundColor: tokens.color.bg, color: tokens.color.text, borderRadius: 8, paddingHorizontal: tokens.space[4], minHeight: tokens.minTap, fontSize: 16 },
  errorText: { color: tokens.color.danger, marginTop: tokens.space[2] },
  row: { flexDirection: 'row', gap: tokens.space[2], marginTop: tokens.space[3] },
  chip: { minHeight: tokens.minTap, paddingHorizontal: tokens.space[4], borderRadius: 8, justifyContent: 'center', borderWidth: 1, borderColor: tokens.color.borderStrong },
  chipSelected: { borderColor: tokens.color.accent },
  chipText: { color: tokens.color.text },
  chipTextSelected: { color: tokens.color.accent, fontWeight: '600' },
  button: { minHeight: tokens.minTap, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[3], backgroundColor: tokens.color.accent },
  buttonText: { color: tokens.color.bg, fontWeight: '600', fontSize: 16 },
  link: { minHeight: tokens.minTap, justifyContent: 'center', alignItems: 'center' },
  linkText: { color: tokens.color.accent, fontSize: 16 },
  summary: { marginTop: tokens.space[4], padding: tokens.space[4], borderRadius: 8, backgroundColor: tokens.color.surface },
});

export default withAccountKey(WorkoutScreen);
