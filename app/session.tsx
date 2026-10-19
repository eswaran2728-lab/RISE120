import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Href, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { withAccountKey } from '../src/auth/withAccountKey';
import { useLocalDate } from '../src/lib/useLocalDate';
import { loadUnits } from '../src/profile/cache';
import { flushPending } from '../src/sync/flush';
import { supabaseTransport } from '../src/sync/supabaseTransport';
import { loadExerciseLinks } from '../src/workout/availability';
import { nextSetNumber, parseSetFields, queueWorkoutSet, SessionSet } from '../src/workout/log';
import { pick } from '../src/workout/localise';
import { loadSessionSets } from '../src/workout/session';
import { completeSession, loadSessionExercises, SessionExercises } from '../src/workout/sessionActions';
import type { SessionSummary } from '../src/workout/summary';
import { ActionButton } from '../src/ui/ActionButton';
import { AsyncState } from '../src/ui/AsyncState';
import { ScreenFrame } from '../src/ui/ScreenFrame';
import { SectionCard } from '../src/ui/SectionCard';

interface Loaded {
  session: SessionExercises;
  links: Map<string, string>;
  sets: SessionSet[];
  units: 'metric' | 'imperial';
}

// A started guided session: its exercises, the sets done out of the sets planned, logging sets, opening an exercise
// for its steps and swap, and finishing once. The server records what was done; this screen never finishes twice.
function SessionScreen() {
  const language = useLanguage();
  const router = useRouter();
  const { session: auth } = useSession();
  const userId = auth?.user?.id;
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
  const today = useLocalDate();

  const [loaded, setLoaded] = useState<Loaded | 'loading' | 'error'>('loading');
  const [selected, setSelected] = useState<string | null>(null);
  const [repsText, setRepsText] = useState('');
  const [weightText, setWeightText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!userId || !sessionId) return;
    const [session, links, sets, units] = await Promise.all([
      loadSessionExercises(sessionId),
      loadExerciseLinks().catch(() => null),
      loadSessionSets(userId, today).catch(() => []),
      loadUnits(userId).catch(() => 'metric' as const),
    ]);
    if (!alive.current) return;
    setLoaded(session ? { session, links: links ?? new Map(), sets, units } : 'error');
  }, [userId, sessionId, today]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const refreshSets = async () => {
    if (!userId || typeof loaded === 'string') return;
    const sets = await loadSessionSets(userId, today).catch(() => loaded.sets);
    if (alive.current) setLoaded((current) => (typeof current === 'string' ? current : { ...current, sets }));
  };

  if (!userId || !sessionId) return <AsyncState state={{ kind: 'error', message: t('guided.loadError') }} />;
  if (loaded === 'loading') return <AsyncState state={{ kind: 'loading' }} />;
  if (loaded === 'error') return <AsyncState state={{ kind: 'error', message: t('guided.loadError'), onRetry: load }} />;

  const { session, links, sets, units } = loaded;
  const finished = session.status === 'completed' || summary !== null;

  const logSet = async () => {
    const uuid = selected ? links.get(selected) : undefined;
    if (!selected || !uuid) return;
    const parsed = parseSetFields({ reps: repsText, weight: weightText, units });
    if (!parsed.ok) {
      setError(t(parsed.reason === 'invalid' ? 'onboarding.errors.number' : parsed.reason === 'min' ? 'onboarding.errors.tooLow' : 'onboarding.errors.tooHigh'));
      return;
    }
    setError(null);
    try {
      await queueWorkoutSet(userId, today, { exerciseId: uuid, setNumber: nextSetNumber(sets, uuid), reps: repsText, weight: weightText, units, sessionId });
    } catch {
      setError(t('errors.generic'));
      return;
    }
    setRepsText('');
    setWeightText('');
    await refreshSets();
    void flushPending(userId, supabaseTransport).then(refreshSets).catch(() => undefined);
  };

  const finish = async () => {
    const result = await completeSession(sessionId);
    if (!alive.current) return;
    if (result.kind === 'completed') {
      setSummary(result.summary);
      setMessage(null);
    } else if (result.kind === 'nothing_logged') {
      setMessage(t('exercise.nothingLogged'));
    } else if (result.kind === 'offline') {
      setMessage(t('exercise.finishOffline'));
    } else if (result.kind === 'not_found') {
      setLoaded('error');
    } else {
      setMessage(t('exercise.finishError'));
    }
  };

  return (
    <ScreenFrame>
      <ActionButton variant="link" label={t('onboarding.back')} onPress={() => router.back()} />
      <Text accessibilityRole="header" style={styles.title}>{t('guided.sessionTitle')}</Text>
      {finished ? <Text style={styles.note}>{t('guided.finishedNote')}</Text> : null}

      {session.exercises.map((entry) => {
        const uuid = links.get(entry.exerciseId);
        const done = entry.kept ? entry.sets : Math.min(entry.sets, uuid ? sets.filter((s) => s.exerciseId === uuid).length : 0);
        const open = !finished && !entry.kept && selected === entry.exerciseId && uuid !== undefined;
        return (
          <SectionCard key={entry.exerciseId} title={pick(entry.name, language)}>
            <Text style={styles.body}>{t('guided.setsProgress', { done, total: entry.sets })}</Text>
            {entry.kept ? <Text style={styles.note}>{t('guided.kept')}</Text> : null}
            {!entry.kept && !uuid ? <Text style={styles.note}>{t('guided.cannotLog')}</Text> : null}
            <ActionButton testID={`session-open-${entry.exerciseId}`} variant="secondary" label={t('guided.howTo')} onPress={() => router.push({ pathname: '/exercise', params: { sessionId, exerciseId: entry.exerciseId } } as unknown as Href)} />
            {!finished && !entry.kept && uuid ? (
              <ActionButton testID={`session-log-${entry.exerciseId}`} variant={open ? 'primary' : 'secondary'} label={t('guided.logSet')} onPress={() => { setSelected(entry.exerciseId); setError(null); }} />
            ) : null}
            {open ? (
              <View style={styles.form}>
                <TextInput testID="session-reps" accessibilityLabel={t('guided.reps')} placeholder={t('guided.reps')} placeholderTextColor={tokens.color.textSecondary} keyboardType="number-pad" value={repsText} onChangeText={setRepsText} style={styles.input} />
                <TextInput testID="session-weight" accessibilityLabel={t(units === 'imperial' ? 'guided.weightLb' : 'guided.weightKg')} placeholder={t(units === 'imperial' ? 'guided.weightLb' : 'guided.weightKg')} placeholderTextColor={tokens.color.textSecondary} keyboardType="decimal-pad" value={weightText} onChangeText={setWeightText} style={styles.input} />
                {error ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{error}</Text> : null}
                <ActionButton testID="session-save" label={t('guided.saveSet')} onPress={logSet} />
              </View>
            ) : null}
          </SectionCard>
        );
      })}

      {summary ? (
        <SectionCard title={t('exercise.summaryTitle')} tone="accent">
          <Text style={styles.onAccent}>{t('exercise.summarySets', { count: summary.setsCompleted })}</Text>
          <Text style={styles.onAccent}>{t('exercise.summaryReps', { count: summary.totalReps })}</Text>
          <Text style={styles.onAccent}>{t('exercise.summaryVolume', { count: summary.volumeKg })}</Text>
          <Text style={styles.onAccentNote}>{t('exercise.summaryNote')}</Text>
        </SectionCard>
      ) : !finished ? (
        <ActionButton testID="session-finish" label={t('exercise.finish')} onPress={finish} />
      ) : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{message}</Text> : null}
    </ScreenFrame>
  );
}

export default withAccountKey(SessionScreen);

const styles = StyleSheet.create({
  title: { color: tokens.color.text, fontSize: 28, lineHeight: 36, fontWeight: '700', marginBottom: tokens.space[2] },
  body: { color: tokens.color.text, fontSize: 16, lineHeight: 24, marginVertical: tokens.space[1] },
  note: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginVertical: tokens.space[2] },
  warning: { color: tokens.color.warning, fontSize: 16, lineHeight: 24, marginVertical: tokens.space[2] },
  form: { marginTop: tokens.space[3] },
  input: { minHeight: tokens.minTap, borderRadius: tokens.radius.control, borderWidth: 1, borderColor: tokens.color.borderStrong, backgroundColor: tokens.color.surfaceRaised, color: tokens.color.text, fontSize: 16, paddingHorizontal: tokens.space[3], marginBottom: tokens.space[2] },
  onAccent: { color: tokens.color.onAccent, fontSize: 16, lineHeight: 24 },
  onAccentNote: { color: tokens.color.onAccent, fontSize: 14, lineHeight: 21, marginTop: tokens.space[2] },
});
