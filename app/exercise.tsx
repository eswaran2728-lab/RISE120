import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { withAccountKey } from '../src/auth/withAccountKey';
import { newLogId } from '../src/food/log';
import { useLocalDate } from '../src/lib/useLocalDate';
import type { ExerciseVersion } from '../src/workout/catalogue';
import { loadExercises } from '../src/workout/catalogueData';
import { loadAvailability, loadExerciseLinks } from '../src/workout/availability';
import { notifyWorkoutSetLogged } from '../src/workout/events';
import { loadSessionSets } from '../src/workout/session';
import { completeSession, loadSessionExercises, swapRemainingExercise, SessionExercise, SessionExercises } from '../src/workout/sessionActions';
import { eligibleSwaps, Availability } from '../src/workout/swaps';
import type { SessionSummary } from '../src/workout/summary';
import { ActionButton } from '../src/ui/ActionButton';
import { AsyncState } from '../src/ui/AsyncState';
import { ExerciseDemo } from '../src/ui/ExerciseDemo';
import { ScreenFrame } from '../src/ui/ScreenFrame';
import { SectionCard } from '../src/ui/SectionCard';
import { SwapSheet } from '../src/ui/SwapSheet';

interface Loaded {
  session: SessionExercises;
  catalogue: ExerciseVersion[];
  availability: Availability | null;
  links: Map<string, string> | null;
  loggedByExercise: Map<string, number>; // sets logged today, by the exercise that logged sets use
}

// One exercise of a started workout: how to do it (written cues always, video only on request), a safe swap for
// the sets still to do, and finishing the workout. The server is the authority on every change; this screen shows
// what happened and never swaps or finishes twice.
function ExerciseScreen() {
  useLanguage();
  const language = useLanguage();
  const router = useRouter();
  const { session: auth } = useSession();
  const userId = auth?.user?.id;
  const params = useLocalSearchParams<{ sessionId?: string; exerciseId?: string }>();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
  const today = useLocalDate();

  const [currentId, setCurrentId] = useState(typeof params.exerciseId === 'string' ? params.exerciseId : '');
  const [loaded, setLoaded] = useState<Loaded | 'loading' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const alive = useRef(true);
  // The same swap keeps the same request id until it gets a definite answer, so a retry after a lost reply cannot swap twice.
  const swapRequest = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!userId || !sessionId) return;
    const [session, catalogue, availability, links, sets] = await Promise.all([
      loadSessionExercises(sessionId),
      loadExercises(userId),
      loadAvailability(userId, sessionId).catch(() => null),
      loadExerciseLinks().catch(() => null),
      loadSessionSets(userId, today).catch(() => []),
    ]);
    if (!alive.current) return;
    if (!session) return setLoaded('error');
    const loggedByExercise = new Map<string, number>();
    for (const set of sets) loggedByExercise.set(set.exerciseId, (loggedByExercise.get(set.exerciseId) ?? 0) + 1);
    setLoaded({ session, catalogue, availability, links, loggedByExercise });
  }, [userId, sessionId, today]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!userId || !sessionId) return <AsyncState state={{ kind: 'error', message: t('exercise.loadError') }} />;
  if (loaded === 'loading') return <AsyncState state={{ kind: 'loading' }} />;
  if (loaded === 'error') return <AsyncState state={{ kind: 'error', message: t('exercise.loadError'), onRetry: load }} />;

  const { session, catalogue, availability, links, loggedByExercise } = loaded;
  const finished = session.status === 'completed' || summary !== null;
  const entry: SessionExercise | undefined = session.exercises.find((e) => e.exerciseId === currentId && !e.kept) ?? session.exercises.find((e) => e.exerciseId === currentId);
  const known = catalogue.find((e) => e.id === currentId);

  const swapUi = () => {
    if (!entry || finished) return null;
    const uuid = links?.get(currentId);
    const done = entry.kept ? entry.sets : Math.min(entry.sets, uuid ? (loggedByExercise.get(uuid) ?? 0) : 0);
    const remaining = entry.kept ? 0 : entry.sets - done;
    const options = known && availability ? eligibleSwaps(known, availability, { exercises: catalogue, sessions: [] }, session.exercises.map((e) => e.exerciseId)) : [];

    const confirm = async (replacementId: string) => {
      const key = `${session.revision}:${currentId}:${replacementId}`;
      if (swapRequest.current?.key !== key) swapRequest.current = { key, id: newLogId() };
      const result = await swapRemainingExercise({ sessionId, requestId: swapRequest.current.id, expectedRevision: session.revision, fromExerciseId: currentId, replacementId });
      if (!alive.current) return;
      if (result.kind === 'swapped') {
        swapRequest.current = null;
        setLoaded({ ...loaded, session: { ...session, revision: result.revision, exercises: result.exercises } });
        setCurrentId(replacementId);
        setMessage(t('exercise.swapDone'));
      } else if (result.kind === 'offline' || result.kind === 'error') {
        setMessage(t(result.kind === 'offline' ? 'exercise.swapOffline' : 'exercise.swapError'));
      } else {
        swapRequest.current = null;
        if (result.kind === 'stale') {
          setMessage(t('exercise.stale'));
          await load();
        } else if (result.kind === 'session_completed') {
          setMessage(t('exercise.finished'));
          await load();
        } else if (result.kind === 'not_found') {
          setLoaded('error');
        } else {
          setMessage(t('exercise.swapRefused'));
        }
      }
    };

    return <SwapSheet currentName={entry.name} options={options} doneSets={done} remainingSets={remaining} language={language} message={message} onConfirm={confirm} />;
  };

  const finish = async () => {
    const result = await completeSession(sessionId);
    if (!alive.current) return;
    if (result.kind === 'completed') {
      setSummary(result.summary);
      setMessage(null);
      if (userId) notifyWorkoutSetLogged(userId); // the day's workout changed: reminders re-read it
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
      {entry ? (
        <ExerciseDemo exercise={known ?? { name: entry.name, cues: [], media: null }} language={language} />
      ) : (
        <SectionCard>
          <Text style={styles.note}>{t('exercise.gone')}</Text>
        </SectionCard>
      )}

      {swapUi()}

      {summary ? (
        <SectionCard title={t('exercise.summaryTitle')} tone="accent">
          <Text style={styles.onAccent}>{t('exercise.summarySets', { count: summary.setsCompleted })}</Text>
          <Text style={styles.onAccent}>{t('exercise.summaryReps', { count: summary.totalReps })}</Text>
          <Text style={styles.onAccent}>{t('exercise.summaryVolume', { count: summary.volumeKg })}</Text>
          <Text style={styles.onAccentNote}>{t('exercise.summaryNote')}</Text>
        </SectionCard>
      ) : session.status === 'completed' ? (
        <Text style={styles.note}>{t('exercise.finished')}</Text>
      ) : (
        <>
          <ActionButton testID="exercise-finish" label={t('exercise.finish')} onPress={finish} />
          {message && !entry ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{message}</Text> : null}
        </>
      )}
    </ScreenFrame>
  );
}

export default withAccountKey(ExerciseScreen);

const styles = StyleSheet.create({
  note: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginVertical: tokens.space[2] },
  warning: { color: tokens.color.warning, fontSize: 16, lineHeight: 24, marginTop: tokens.space[2] },
  onAccent: { color: tokens.color.onAccent, fontSize: 16, lineHeight: 24 },
  onAccentNote: { color: tokens.color.onAccent, fontSize: 14, lineHeight: 21, marginTop: tokens.space[2] },
});
