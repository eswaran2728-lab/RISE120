import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { t } from '../i18n';
import { randomId } from '../lib/randomId';
import { tokens } from '../theme/tokens';
import { ActionButton } from '../ui/ActionButton';
import { groupShares, shareMilestone, withdrawShare } from './api';
import { MESSAGE } from './messages';
import type { BuddyGroup, GroupShare, Milestone } from './types';

// A member's completion milestones for one group. Nothing is shared by opening this: the member previews exactly what
// the group would see, a name and a number, and must confirm before the server is asked to share it. Withdrawing is
// immediate. What the group can read is only ever a display name and a number of workout days.
export function GroupMilestones({ group, milestones }: { group: BuddyGroup; milestones: Milestone[] | null }) {
  const [shares, setShares] = useState<GroupShare[] | null>(null);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  const sending = useRef(false);
  // A share keeps one request id until the server gives a definite answer, so a lost reply cannot be repeated as a new share.
  const request = useRef<{ milestone: number; id: string } | null>(null);
  const myName = group.members.find((m) => m.memberId === group.me.memberId)?.displayName ?? '';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const result = await groupShares(group.id).catch(() => ({ kind: 'offline' as const }));
    if (alive.current) setShares(result.kind === 'ok' ? result.shares : null);
  }, [group.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const mine = new Set((shares ?? []).filter((s) => s.mine).map((s) => s.milestone));
  const offers = (milestones ?? []).filter((m) => !mine.has(m.milestone));

  const confirm = async (milestone: number) => {
    if (sending.current) return;
    sending.current = true;
    try {
      if (request.current?.milestone !== milestone) request.current = { milestone, id: randomId() };
      const result = await shareMilestone({ groupId: group.id, milestone, requestId: request.current.id });
      if (!alive.current) return;
      if (result.kind === 'ok') {
        request.current = null;
        setPreviewing(null);
        setMessage(t('buddy.shared'));
        await load();
      } else {
        // Anything but a lost connection is a definite answer: the next attempt is a fresh, deliberate request.
        if (result.kind !== 'offline' && result.kind !== 'error') request.current = null;
        setMessage(t(MESSAGE[result.kind]));
      }
    } finally {
      sending.current = false;
    }
  };

  const withdraw = async (milestone: number) => {
    const result = await withdrawShare(group.id, milestone);
    if (!alive.current) return;
    if (result.kind === 'ok' || result.kind === 'not_found') {
      setMessage(t('buddy.withdrawn'));
      await load();
    } else {
      setMessage(t(MESSAGE[result.kind]));
    }
  };

  return (
    <View style={styles.box}>
      <Text accessibilityRole="header" style={styles.title}>{t('buddy.milestonesTitle')}</Text>

      {(shares ?? []).map((s) => (
        <View key={`${s.memberId}-${s.milestone}`}>
          <Text style={styles.body}>{t('buddy.milestoneLine', { name: s.displayName, count: s.milestone })}</Text>
          {s.mine ? <ActionButton testID={`buddy-withdraw-${group.id}-${s.milestone}`} variant="link" label={t('buddy.withdraw', { count: s.milestone })} onPress={() => withdraw(s.milestone)} /> : null}
        </View>
      ))}

      {milestones === null ? (
        <Text style={styles.note}>{t('buddy.milestonesUnavailable')}</Text>
      ) : milestones.length === 0 ? (
        <Text style={styles.note}>{t('buddy.noMilestones')}</Text>
      ) : (
        offers.map((m) => (
          <View key={m.milestone}>
            <ActionButton
              testID={`buddy-milestone-preview-${group.id}-${m.milestone}`}
              variant="secondary"
              label={t('buddy.previewMilestone', { count: m.milestone })}
              onPress={() => {
                setMessage(null);
                setPreviewing(m.milestone);
              }}
            />
            {previewing === m.milestone ? (
              <View style={styles.preview}>
                <Text style={styles.body}>{t('buddy.previewSays', { group: group.name, name: myName, count: m.milestone })}</Text>
                <Text style={styles.note}>{t('buddy.previewOnly')}</Text>
                <ActionButton testID={`buddy-milestone-confirm-${group.id}-${m.milestone}`} label={t('buddy.shareConfirm')} onPress={() => confirm(m.milestone)} />
                <ActionButton testID={`buddy-milestone-cancel-${group.id}-${m.milestone}`} variant="link" label={t('buddy.shareCancel')} onPress={() => setPreviewing(null)} />
              </View>
            ) : null}
          </View>
        ))
      )}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: tokens.space[3] },
  title: { color: tokens.color.accent, fontSize: 18, lineHeight: 27, fontWeight: '600' },
  body: { color: tokens.color.text, fontSize: 16, lineHeight: 24, marginTop: tokens.space[1] },
  note: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginTop: tokens.space[2], marginBottom: tokens.space[2] },
  message: { color: tokens.color.warning, fontSize: 16, lineHeight: 24, marginTop: tokens.space[2] },
  preview: { marginTop: tokens.space[2], padding: tokens.space[3], borderRadius: tokens.radius.control, backgroundColor: tokens.color.surfaceRaised },
});
