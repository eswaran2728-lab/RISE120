import React, { useCallback } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { t } from '../../src/i18n';
import { useLanguage } from '../../src/i18n/useLanguage';
import { tokens } from '../../src/theme/tokens';
import { formatReset, unlockActions } from '../../src/monetization/limits';
import { useUnlock } from '../../src/monetization/useUnlock';
import { useCoach } from '../../src/coach/useCoach';
import { COACH_MESSAGE_MAX_CHARS } from '../../src/coach/types';
import { LimitNotice } from '../../src/ui/LimitNotice';
import { CoachProposalCard } from '../../src/ui/CoachProposalCard';

const UNCERTAIN = ['unknown', 'in_progress', 'offline'];
const PHASE_MESSAGES: Record<string, string> = {
  sending: 'coach.sending',
  in_progress: 'coach.inProgress',
  unknown: 'coach.unknownOutcome',
  offline: 'coach.offline',
  unavailable: 'coach.unavailable',
  invalid: 'coach.invalid',
  error: 'coach.error',
};

export default function CoachScreen() {
  useLanguage();
  const coach = useCoach();
  const { userId, view } = coach;
  const unlock = useUnlock({
    rewardType: 'ai',
    onChanged: () => {
      if (userId) void coach.refreshLimits(userId);
    },
  });

  const { loadAll } = coach;
  useFocusEffect(
    useCallback(() => {
      if (userId) void loadAll(userId);
    }, [userId, loadAll])
  );

  if (!view) return <View style={styles.container} />;

  const { attempt, limits } = view;
  const snapshot = limits?.snapshot ?? null;
  const draft = view.draft.trim();
  const sending = attempt?.phase === 'sending';
  const waiting = attempt?.phase === 'rate_limited' && coach.secondsLeft > 0;
  const uncertainSameMessage = !!attempt && UNCERTAIN.includes(attempt.phase) && attempt.message === draft;
  const sendDisabled = !draft || sending || waiting || uncertainSameMessage;

  const allowance = snapshot?.ai ?? null;
  const allowanceText = !allowance
    ? null
    : allowance.base === null
      ? `${t('coach.allowanceLabel')}: ${t('limits.unlimited')}`
      : `${t('coach.allowanceLabel')}: ${allowance.used} / ${allowance.base + allowance.bonus}`;

  const exhausted = (snapshot?.tier === 'free' && allowance?.remaining === 0) || attempt?.phase === 'limit';
  const resetsAt = attempt?.resetsAt ?? snapshot?.resetsAt ?? null;
  const reset = resetsAt ? formatReset(resetsAt) : null;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t('coach.title')}</Text>
        <Text style={styles.note}>{t('coach.safetyNote')}</Text>
        <Text style={styles.note}>{t('coach.contextNote')}</Text>
        {allowanceText ? <Text style={styles.allowance}>{allowanceText}</Text> : null}
        {limits?.stale ? <Text style={styles.note}>{t('limits.lastKnown')}</Text> : null}

        {exhausted && snapshot?.tier !== 'premium' ? (
          <LimitNotice
            body={t('coach.limitReached')}
            detail={reset ? `${t('limits.resetsAt')} ${reset.local} (${reset.utc} UTC)` : null}
            actions={unlockActions(snapshot, 'ai')}
            onAction={unlock.run}
            busy={unlock.busy}
            message={unlock.messageKey ? t(unlock.messageKey) : null}
          />
        ) : null}

        {view.historyState === 'loading' ? (
          <View style={styles.row}>
            <ActivityIndicator color={tokens.color.accent} />
            <Text style={styles.note}>{t('coach.loadingHistory')}</Text>
          </View>
        ) : null}
        {view.historyState === 'offline' ? <Text style={styles.note}>{t('coach.offlineHistory')}</Text> : null}
        {view.historyState === 'error' && view.history.length === 0 ? (
          <>
            <Text style={styles.warning}>{t('coach.historyError')}</Text>
            <TouchableOpacity testID="coach-retry-history" accessibilityRole="button" style={styles.secondary} onPress={coach.retryHistory}>
              <Text style={styles.secondaryText}>{t('errors.retry')}</Text>
            </TouchableOpacity>
          </>
        ) : null}
        {view.historyState === 'ready' && view.history.length === 0 ? <Text style={styles.note}>{t('coach.empty')}</Text> : null}

        {view.history.map((exchange) => (
          <View key={exchange.requestId} style={styles.exchange}>
            <View style={styles.mine}>
              <Text style={styles.mineText}>{exchange.message}</Text>
            </View>
            <View style={styles.theirs}>
              <Text style={styles.theirsText}>{exchange.reply}</Text>
              {exchange.proposal ? (
                <CoachProposalCard
                  proposal={exchange.proposal}
                  plan={view.plan}
                  deciding={!!view.deciding[exchange.proposal.id]}
                  decisionError={!!view.decisionError[exchange.proposal.id]}
                  refresh={view.refresh[exchange.proposal.id]}
                  onAccept={() => void coach.decide(exchange.proposal!.id, 'accept')}
                  onDecline={() => void coach.decide(exchange.proposal!.id, 'decline')}
                  onRefreshPlan={() => void coach.retryRefresh(exchange.proposal!.id)}
                />
              ) : null}
            </View>
          </View>
        ))}
        {view.proposalDropped ? <Text style={styles.note}>{t('coach.proposalDropped')}</Text> : null}

        {attempt && PHASE_MESSAGES[attempt.phase] ? (
          <View style={styles.status}>
            <Text style={attempt.phase === 'sending' ? styles.note : styles.warning}>{t(PHASE_MESSAGES[attempt.phase])}</Text>
            {UNCERTAIN.includes(attempt.phase) ? (
              <TouchableOpacity testID="coach-check-again" accessibilityRole="button" style={styles.secondary} onPress={() => void coach.checkAgain()}>
                <Text style={styles.secondaryText}>{t('coach.checkAgain')}</Text>
              </TouchableOpacity>
            ) : null}
            {attempt.phase === 'unknown' ? (
              <TouchableOpacity testID="coach-ask-again" accessibilityRole="button" style={styles.secondary} onPress={() => void coach.askAgain()}>
                <Text style={styles.secondaryText}>{t('coach.askAgain')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        {waiting ? (
          <View style={styles.status}>
            <Text style={styles.warning}>{t('coach.rateLimited')}</Text>
            <Text style={styles.note}>{`${t('coach.tryAgainIn')} ${coach.secondsLeft} ${t('coach.seconds')}`}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          testID="coach-input"
          style={styles.input}
          value={view.draft}
          onChangeText={coach.setDraft}
          placeholder={t('coach.placeholder')}
          placeholderTextColor={tokens.color.textSecondary}
          multiline
          maxLength={COACH_MESSAGE_MAX_CHARS}
          editable={!sending}
        />
        <TouchableOpacity testID="coach-send" accessibilityRole="button" disabled={sendDisabled} style={[styles.send, sendDisabled && styles.dim]} onPress={() => void coach.send()}>
          <Text style={styles.sendText}>{t(sending ? 'coach.sending' : 'coach.send')}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const MUTED = tokens.color.textSecondary;
const WARNING = tokens.color.warning;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[5], paddingTop: tokens.space[7], paddingBottom: tokens.space[5] },
  title: { color: tokens.color.text, fontSize: 28, fontWeight: '700' },
  note: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: tokens.space[2] },
  warning: { color: WARNING, fontSize: 14, lineHeight: 20, marginTop: tokens.space[2] },
  allowance: { color: tokens.color.text, fontSize: 15, fontWeight: '600', marginTop: tokens.space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2], marginTop: tokens.space[3] },
  exchange: { marginTop: tokens.space[4] },
  mine: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: tokens.color.accent, borderRadius: 12, padding: tokens.space[3] },
  mineText: { color: tokens.color.bg, fontSize: 15, lineHeight: 21 },
  theirs: { alignSelf: 'flex-start', maxWidth: '92%', backgroundColor: tokens.color.surface, borderRadius: 12, padding: tokens.space[3], marginTop: tokens.space[2] },
  theirsText: { color: tokens.color.text, fontSize: 15, lineHeight: 21 },
  status: { marginTop: tokens.space[3] },
  secondary: { minHeight: tokens.minTap, alignSelf: 'flex-start', borderRadius: 8, borderWidth: 1, borderColor: tokens.color.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: tokens.space[4], marginTop: tokens.space[2] },
  secondaryText: { color: tokens.color.accent, fontWeight: '600', fontSize: 15 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: tokens.space[2], padding: tokens.space[3], backgroundColor: tokens.color.surface },
  input: { flex: 1, maxHeight: 120, minHeight: tokens.minTap, color: tokens.color.text, backgroundColor: tokens.color.bg, borderRadius: 8, paddingHorizontal: tokens.space[3], paddingVertical: tokens.space[2], fontSize: 16 },
  send: { minHeight: tokens.minTap, borderRadius: 8, backgroundColor: tokens.color.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: tokens.space[4] },
  sendText: { color: tokens.color.bg, fontWeight: '600', fontSize: 16 },
  dim: { opacity: 0.5 },
});
