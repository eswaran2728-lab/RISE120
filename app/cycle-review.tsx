import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Href, useFocusEffect, useRouter } from 'expo-router';
import { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { withAccountKey } from '../src/auth/withAccountKey';
import { useLocalDate } from '../src/lib/useLocalDate';
import { loadPlanBundle } from '../src/plan/planData';
import { loadCheckinDates, loadWorkoutDates } from '../src/today/load';
import { cycleStage, nextCycleStartDate, participationSummary, ParticipationSummary } from '../src/journey/completion';
import { CycleMode, startNextCycle } from '../src/journey/cycles';
import { clearPendingCycle, takePendingCycle } from '../src/journey/pendingCycle';
import { ActionButton } from '../src/ui/ActionButton';
import { AsyncState } from '../src/ui/AsyncState';
import { ScreenFrame } from '../src/ui/ScreenFrame';
import { SectionCard } from '../src/ui/SectionCard';

type Loaded = { state: 'loading' } | { state: 'error' } | { state: 'none' } | { state: 'ready'; startDate: string; summary: ParticipationSummary };

// The end of a 120-day cycle. It shows what the member did as plain counts and offers two explicit choices; nothing
// is chosen or started for them. A choice that gets no answer keeps its request id (see pendingCycle), so retrying
// never starts a second cycle.
function CycleReviewScreen() {
  useLanguage();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const today = useLocalDate();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  const running = useRef(false); // one choice at a time, across both buttons

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoaded({ state: 'loading' });
    try {
      const bundle = await loadPlanBundle(userId);
      if (!alive.current) return;
      if (!bundle) return setLoaded({ state: 'none' });
      const [checkinDates, workoutDates] = await Promise.all([loadCheckinDates(userId), loadWorkoutDates(userId)]);
      if (!alive.current) return;
      setLoaded({ state: 'ready', startDate: bundle.plan.startDate, summary: participationSummary({ startDate: bundle.plan.startDate, today, checkinDates, workoutDates }) });
    } catch {
      if (alive.current) setLoaded({ state: 'error' });
    }
  }, [userId, today]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const choose = async (mode: CycleMode) => {
    if (!userId || loaded.state !== 'ready' || running.current) return;
    const startDate = nextCycleStartDate(loaded.startDate, today);
    if (!startDate) return;
    running.current = true;
    setMessage(null);
    try {
      const pending = await takePendingCycle(userId, mode);
      const result = await startNextCycle(userId, { requestId: pending.requestId, mode: pending.mode, startDate });
      if (result.kind === 'started') {
        await clearPendingCycle(userId);
        if (alive.current) router.replace('/(tabs)/today' as Href);
        return;
      }
      // A clear answer ends the request; no answer (or a server fault) keeps it so the retry is the same request.
      if (result.kind === 'not_finished' || result.kind === 'no_plan' || result.kind === 'profile_incomplete' || result.kind === 'invalid') await clearPendingCycle(userId);
      const key = { offline: 'cycle.offline', not_finished: 'cycle.notFinished', no_plan: 'cycle.noPlan', profile_incomplete: 'cycle.profileIncomplete', invalid: 'cycle.error', error: 'cycle.error' }[result.kind];
      if (alive.current) setMessage(t(key));
    } finally {
      running.current = false;
    }
  };

  if (loaded.state === 'loading') return <AsyncState state={{ kind: 'loading' }} />;
  if (loaded.state === 'error') return <AsyncState state={{ kind: 'error', message: t('cycle.loadError'), onRetry: load }} />;
  if (loaded.state === 'none') return <AsyncState state={{ kind: 'empty', message: t('cycle.noPlan') }} />;

  if (cycleStage(loaded.startDate, today) !== 'ready_for_review') {
    return (
      <ScreenFrame>
        <SectionCard title={t('cycle.title')}>
          <Text style={styles.body}>{t('cycle.notReady')}</Text>
        </SectionCard>
        <ActionButton label={t('cycle.back')} variant="secondary" onPress={() => router.back()} />
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame>
      <SectionCard title={t('cycle.title')}>
        <Text style={styles.body}>{t('cycle.intro')}</Text>
        <Text style={styles.count}>{t('cycle.checkinDays', { count: loaded.summary.checkinDays })}</Text>
        <Text style={styles.count}>{t('cycle.workoutDays', { count: loaded.summary.workoutDays })}</Text>
        <Text style={styles.note}>{t('cycle.logsStay')}</Text>
      </SectionCard>

      <SectionCard title={t('cycle.chooseTitle')}>
        <View style={styles.choice}>
          <ActionButton testID="cycle-progression" label={t('cycle.progression')} variant="secondary" onPress={() => choose('progression')} />
          <Text style={styles.note}>{t('cycle.progressionBody')}</Text>
        </View>
        <View style={styles.choice}>
          <ActionButton testID="cycle-maintenance" label={t('cycle.maintenance')} variant="secondary" onPress={() => choose('maintenance')} />
          <Text style={styles.note}>{t('cycle.maintenanceBody')}</Text>
        </View>
        <View accessibilityLiveRegion="polite">{message ? <Text style={styles.message}>{message}</Text> : null}</View>
      </SectionCard>
    </ScreenFrame>
  );
}

export default withAccountKey(CycleReviewScreen);

const styles = StyleSheet.create({
  body: { color: tokens.color.text, fontSize: 16, lineHeight: 24 },
  count: { color: tokens.color.text, fontSize: 16, lineHeight: 24, marginTop: tokens.space[2] },
  note: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginTop: tokens.space[2] },
  choice: { marginBottom: tokens.space[3] },
  message: { color: tokens.color.warning, fontSize: 16, lineHeight: 24 },
});
