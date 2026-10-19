import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Href, useRouter } from 'expo-router';
import { t } from '../i18n';
import { newLogId } from '../food/log';
import { tokens } from '../theme/tokens';
import { SESSION_MINUTES, Minutes, SessionTemplate } from '../workout/catalogue';
import { GuidedState, loadGuidedState } from '../workout/guidedSession';
import { startSession } from '../workout/sessions';
import { Energy, selectSession } from '../workout/sessionChoice';
import { ActionButton } from './ActionButton';
import { SectionCard } from './SectionCard';

interface Props {
  userId: string;
  planId: string;
  dayNumber: number;
}

const ENERGY: Energy[] = ['low', 'normal', 'high'];
const REASON_KEY = { fits_time: 'guided.reasonFits', shorter_to_fit: 'guided.reasonShorter', gentle_for_low_energy: 'guided.reasonGentle' } as const;
const START_FAILURE: Record<string, string> = {
  offline: 'guided.startOffline',
  day_not_available: 'guided.dayNotAvailable',
  template_unavailable: 'guided.templateGone',
};

// Today's guided session, offered next to the regular workout, which always stays available. Shows one of: nothing
// to offer yet (the reviewed catalogue is empty or not linked), choose-and-start, resume, or done.
export function GuidedSessionCard({ userId, planId, dayNumber }: Props) {
  const router = useRouter();
  const key = `${userId}:${planId}:${dayNumber}`;
  const [held, setHeld] = useState<{ key: string; value: GuidedState } | null>(null);
  // What was loaded for another account, plan or day is never shown for this one.
  const state = held?.key === key ? held.value : null;
  const [minutes, setMinutes] = useState<Minutes>(20);
  const [energy, setEnergy] = useState<Energy>('normal');
  const [proposal, setProposal] = useState<{ template: SessionTemplate; reason: keyof typeof REASON_KEY } | 'none' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  // The same start keeps the same request id until it gets a definite answer, so a retry cannot start two sessions.
  const request = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Only the newest request may set the state, so an answer for the previous account or day that arrives late is dropped.
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    const next = await loadGuidedState({ userId, planId, dayNumber });
    if (alive.current && ticket === latest.current) setHeld({ key: `${userId}:${planId}:${dayNumber}`, value: next });
  }, [userId, planId, dayNumber]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const open = (sessionId: string) => router.push({ pathname: '/session', params: { sessionId } } as unknown as Href);

  const find = () => {
    if (state?.kind !== 'choose') return;
    setMessage(null);
    const choice = selectSession({ minutes, location: state.profile.location, equipment: state.profile.equipment, energy, goal: state.profile.goal, level: state.profile.level, dayType: 'training', variant: dayNumber }, state.catalogue);
    setProposal(choice.available ? { template: choice.template, reason: choice.reason } : 'none');
  };

  const begin = async () => {
    if (!proposal || proposal === 'none') return;
    const { template } = proposal;
    const key = `${planId}:${dayNumber}:${template.id}:${template.version}`;
    if (request.current?.key !== key) request.current = { key, id: newLogId() };
    const result = await startSession({ requestId: request.current.id, planId, dayNumber, templateId: template.id, templateVersion: template.version });
    if (!alive.current) return;
    if (result.kind === 'started') {
      request.current = null;
      setMessage(null);
      open(result.sessionId);
    } else if (result.kind === 'offline') {
      setMessage(t('guided.startOffline'));
    } else {
      request.current = null;
      setMessage(t(START_FAILURE[result.kind] ?? 'guided.startError'));
    }
  };

  if (!state) {
    return (
      <SectionCard title={t('guided.title')}>
        <Text style={styles.note}>{t('states.loading')}</Text>
      </SectionCard>
    );
  }

  let body: React.ReactNode;
  if (state.kind === 'unavailable') {
    body =
      state.reason === 'unreadable' ? (
        <>
          <Text style={styles.note}>{t('guided.unreadable')}</Text>
          <ActionButton
            testID="guided-retry"
            variant="secondary"
            label={t('errors.retry')}
            onPress={() => {
              setHeld(null);
              return reload();
            }}
          />
        </>
      ) : (
        <Text style={styles.note}>{t('guided.unavailable')}</Text>
      );
  } else if (state.kind === 'active') {
    body = <ActionButton testID="guided-resume" label={t('guided.resume')} onPress={() => open(state.sessionId)} />;
  } else if (state.kind === 'done') {
    body = (
      <>
        <Text style={styles.body}>{t('guided.done')}</Text>
        <ActionButton testID="guided-view" variant="secondary" label={t('guided.view')} onPress={() => open(state.sessionId)} />
      </>
    );
  } else {
    body = (
      <>
        <Text style={styles.note}>{t('guided.time')}</Text>
        <View style={styles.row}>
          {SESSION_MINUTES.map((m) => (
            <View key={m} style={styles.chip}>
              <ActionButton testID={`guided-minutes-${m}`} variant={minutes === m ? 'primary' : 'secondary'} label={t('guided.minutes', { count: m })} onPress={() => { setMinutes(m); setProposal(null); }} />
            </View>
          ))}
        </View>
        <Text style={styles.note}>{t('guided.energy')}</Text>
        <View style={styles.row}>
          {ENERGY.map((e) => (
            <View key={e} style={styles.chip}>
              <ActionButton testID={`guided-energy-${e}`} variant={energy === e ? 'primary' : 'secondary'} label={t(`guided.energy_${e}`)} onPress={() => { setEnergy(e); setProposal(null); }} />
            </View>
          ))}
        </View>
        <ActionButton testID="guided-find" variant="secondary" label={t('guided.find')} onPress={find} />
        {proposal === 'none' ? <Text accessibilityLiveRegion="polite" style={styles.note}>{t('guided.noMatch')}</Text> : null}
        {proposal && proposal !== 'none' ? (
          <View style={styles.proposal}>
            <Text style={styles.body}>{t('guided.proposal', { minutes: proposal.template.minutes, count: proposal.template.exercises.length })}</Text>
            <Text style={styles.note}>{t(REASON_KEY[proposal.reason])}</Text>
            <ActionButton testID="guided-start" label={t('guided.start')} onPress={begin} />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <SectionCard title={t('guided.title')}>
      {body}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{message}</Text> : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  body: { color: tokens.color.text, fontSize: 16, lineHeight: 24, marginVertical: tokens.space[2] },
  note: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginVertical: tokens.space[2] },
  warning: { color: tokens.color.warning, fontSize: 16, lineHeight: 24, marginTop: tokens.space[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { marginRight: tokens.space[2], marginBottom: tokens.space[2] },
  proposal: { marginTop: tokens.space[3] },
});
