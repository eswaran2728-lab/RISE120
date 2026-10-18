import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { t } from '../i18n';
import { tokens } from '../theme/tokens';
import { describeProposal, ProposalLine } from '../coach/state';
import type { RefreshState } from '../coach/useCoach';
import type { CoachProposal } from '../coach/types';

interface Props {
  proposal: CoachProposal;
  plan: { startDate: string; names: Record<string, string> } | null;
  deciding: boolean;
  decisionError: boolean;
  refresh: RefreshState | undefined;
  onAccept: () => void;
  onDecline: () => void;
  onRefreshPlan: () => void;
}

const dash = (value: number | null) => (value === null ? '—' : String(value));

function lineText(line: ProposalLine, exerciseFallback: string): string[] {
  if (line.kind === 'workout') {
    return line.rows.map((row) => `${row.before.name ?? exerciseFallback} ${row.before.sets} × ${row.before.reps} → ${row.after.name ?? exerciseFallback} ${row.after.sets} × ${row.after.reps}`);
  }
  if (line.kind === 'calories') return [`${t('coach.proposal.calories')}: ${dash(line.before)} → ${line.after} ${t('today.kcal')}`];
  return [`${t('coach.proposal.protein')}: ${dash(line.before)} → ${line.after} g`];
}

// A coach suggestion with the exact before and after values for each day it would change. Nothing changes until
// the member accepts, and the server re-checks everything at that moment.
export function CoachProposalCard({ proposal, plan, deciding, decisionError, refresh, onAccept, onDecline, onRefreshPlan }: Props) {
  const days = describeProposal(proposal, { startDate: plan?.startDate ?? null, exerciseName: (id) => plan?.names[id] ?? null });
  const fallback = t('coach.proposal.unknownExercise');
  const pending = proposal.status === 'pending';

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('coach.proposal.title')}</Text>
      {days.map((day) => (
        <View key={day.dayNumber} style={styles.day}>
          <Text style={styles.dayTitle}>{`${t('coach.proposal.day')} ${day.dayNumber}${day.date ? ` · ${day.date}` : ''}`}</Text>
          {day.lines.flatMap((line, i) => lineText(line, fallback).map((text, j) => (
            <Text key={`${i}-${j}`} style={styles.line}>{text}</Text>
          )))}
        </View>
      ))}

      {pending ? <Text style={styles.note}>{t('coach.proposal.notChangedUntil')}</Text> : null}
      {proposal.status === 'accepted' ? <Text style={styles.accepted}>{t('coach.proposal.accepted')}</Text> : null}
      {proposal.status === 'declined' ? <Text style={styles.note}>{t('coach.proposal.declined')}</Text> : null}
      {proposal.status === 'stale' ? <Text style={styles.warning}>{t('coach.proposal.stale')}</Text> : null}

      {proposal.status === 'accepted' && refresh === 'refreshing' ? (
        <View style={styles.row}>
          <ActivityIndicator color={tokens.color.accent} />
          <Text style={styles.note}>{t('coach.proposal.refreshing')}</Text>
        </View>
      ) : null}
      {proposal.status === 'accepted' && refresh === 'done' ? <Text style={styles.note}>{t('coach.proposal.refreshed')}</Text> : null}
      {proposal.status === 'accepted' && refresh === 'failed' ? (
        <>
          <Text style={styles.warning}>{t('coach.proposal.refreshFailed')}</Text>
          <TouchableOpacity testID="coach-refresh-plan" accessibilityRole="button" style={styles.secondary} onPress={onRefreshPlan}>
            <Text style={styles.secondaryText}>{t('coach.proposal.refreshPlan')}</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {pending ? (
        <>
          {deciding ? <Text style={styles.note}>{t('coach.proposal.deciding')}</Text> : null}
          {decisionError ? <Text style={styles.warning}>{t('coach.proposal.decisionError')}</Text> : null}
          <View style={styles.row}>
            <TouchableOpacity testID={`coach-accept-${proposal.id}`} accessibilityRole="button" disabled={deciding} style={[styles.primary, deciding && styles.dim]} onPress={onAccept}>
              <Text style={styles.primaryText}>{t('coach.proposal.accept')}</Text>
            </TouchableOpacity>
            <TouchableOpacity testID={`coach-decline-${proposal.id}`} accessibilityRole="button" disabled={deciding} style={[styles.secondary, deciding && styles.dim]} onPress={onDecline}>
              <Text style={styles.secondaryText}>{t('coach.proposal.decline')}</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </View>
  );
}

const MUTED = tokens.color.textSecondary;
const WARNING = tokens.color.warning;

const styles = StyleSheet.create({
  card: { marginTop: tokens.space[2], padding: tokens.space[3], borderRadius: 8, borderWidth: 1, borderColor: tokens.color.accent },
  title: { color: tokens.color.accent, fontSize: 15, fontWeight: '700', marginBottom: tokens.space[1] },
  day: { marginTop: tokens.space[2] },
  dayTitle: { color: tokens.color.text, fontSize: 15, fontWeight: '600' },
  line: { color: tokens.color.text, fontSize: 14, lineHeight: 20, marginTop: 2 },
  note: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: tokens.space[2] },
  accepted: { color: tokens.color.accent, fontSize: 14, fontWeight: '600', marginTop: tokens.space[2] },
  warning: { color: WARNING, fontSize: 13, lineHeight: 18, marginTop: tokens.space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2], marginTop: tokens.space[2] },
  primary: { minHeight: tokens.minTap, borderRadius: 8, backgroundColor: tokens.color.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: tokens.space[4] },
  primaryText: { color: tokens.color.bg, fontWeight: '600', fontSize: 15 },
  secondary: { minHeight: tokens.minTap, borderRadius: 8, borderWidth: 1, borderColor: tokens.color.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: tokens.space[4] },
  secondaryText: { color: tokens.color.accent, fontWeight: '600', fontSize: 15 },
  dim: { opacity: 0.5 },
});
