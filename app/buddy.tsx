import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { withAccountKey } from '../src/auth/withAccountKey';
import { addLocalDays } from '../src/lib/dates';
import { useLocalDate } from '../src/lib/useLocalDate';
import { acceptInvite, blockMember, createGroup, createInvite, getMilestones, groupSummary, leaveGroup, listGroups, removeMember, reportsOpen } from '../src/buddy/api';
import { GroupMilestones } from '../src/buddy/GroupMilestones';
import { MESSAGE } from '../src/buddy/messages';
import { ReportMember } from '../src/buddy/ReportMember';
import { participationScore, rankMembers } from '../src/buddy/score';
import type { BuddyGroup, MemberDays, Milestone } from '../src/buddy/types';
import { ActionButton } from '../src/ui/ActionButton';
import { AsyncState } from '../src/ui/AsyncState';
import { ScreenFrame } from '../src/ui/ScreenFrame';
import { SectionCard } from '../src/ui/SectionCard';

type Loaded = { state: 'loading' } | { state: 'error' } | { state: 'ready'; groups: BuddyGroup[]; days: Record<string, MemberDays[] | null>; milestones: Milestone[] | null; reporting: boolean };

// Private groups. A member sees display names and the days each logged a workout; the screen holds no account id,
// weight, photo or meal. Anything that removes someone (leave, block, remove) asks first.
function BuddyScreen() {
  useLanguage();
  const today = useLocalDate();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [ranking, setRanking] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ groupId: string; token: string; expiresAt: string } | null>(null);
  const [create, setCreate] = useState({ name: '', display: '', accepted: false, message: null as string | null });
  const [join, setJoin] = useState({ token: '', display: '', accepted: false, message: null as string | null });
  const alive = useRef(true);
  const from = addLocalDays(today, -6);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const groups = await listGroups();
    if (!alive.current) return;
    if (!groups) return setLoaded({ state: 'error' });
    const [results, earned, reporting] = await Promise.all([
      Promise.all(groups.map((g) => groupSummary(g.id, from, today))),
      getMilestones().catch(() => ({ kind: 'offline' as const })),
      reportsOpen().catch(() => false),
    ]);
    if (!alive.current) return;
    const days: Record<string, MemberDays[] | null> = {};
    groups.forEach((g, i) => (days[g.id] = results[i].kind === 'ok' ? (results[i] as { members: MemberDays[] }).members : null));
    setLoaded({ state: 'ready', groups, days, milestones: earned.kind === 'ok' ? earned.milestones : null, reporting });
  }, [from, today]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const startGroup = async () => {
    if (!create.name.trim() || !create.display.trim()) return;
    if (!create.accepted) return setCreate((c) => ({ ...c, message: t('buddy.needDisclosure') }));
    const result = await createGroup({ name: create.name.trim(), displayName: create.display.trim(), disclosureAccepted: true });
    if (!alive.current) return;
    if (result.kind !== 'ok') return setCreate((c) => ({ ...c, message: t(MESSAGE[result.kind]) }));
    setCreate({ name: '', display: '', accepted: false, message: null });
    await load();
  };

  const joinGroup = async () => {
    const token = join.token.trim();
    if (!token || !join.display.trim()) return;
    if (!join.accepted) return setJoin((j) => ({ ...j, message: t('buddy.needDisclosure') }));
    const result = await acceptInvite({ token, displayName: join.display.trim(), disclosureAccepted: true });
    if (!alive.current) return;
    if (result.kind !== 'ok') return setJoin((j) => ({ ...j, message: t(MESSAGE[result.kind]) }));
    setJoin({ token: '', display: '', accepted: false, message: null });
    await load();
  };

  const makeInvite = async (groupId: string) => {
    const result = await createInvite(groupId);
    if (!alive.current) return;
    if (result.kind !== 'ok') return setCreate((c) => ({ ...c, message: t(MESSAGE[result.kind]) }));
    setInvite({ groupId, token: result.token, expiresAt: result.expiresAt });
  };

  const run = async (key: string, action: () => Promise<{ kind: string }>) => {
    const result = await action();
    if (!alive.current) return;
    setConfirming(null);
    if (result.kind === 'ok') await load();
  };

  if (loaded.state === 'loading') return <AsyncState state={{ kind: 'loading' }} />;
  if (loaded.state === 'error') return <AsyncState state={{ kind: 'error', message: t('buddy.loadError'), onRetry: load }} />;

  return (
    <ScreenFrame>
      <Text accessibilityRole="header" style={styles.title}>{t('buddy.title')}</Text>
      <Text style={styles.body}>{t('buddy.intro')}</Text>
      <Text style={styles.note}>{t('buddy.disclosure')}</Text>

      {loaded.groups.length === 0 ? <Text style={styles.body}>{t('buddy.noGroups')}</Text> : null}

      {loaded.groups.map((group) => {
        const members = loaded.days[group.id];
        const owner = group.me.role === 'owner';
        return (
          <SectionCard key={group.id} title={group.name}>
            {members === null ? (
              <Text style={styles.note}>{t('buddy.daysUnavailable')}</Text>
            ) : ranking ? (
              <>
                {rankMembers(members, from, today).map((m) => (
                  <Text key={m.memberId} style={styles.body}>{t('buddy.rank', { rank: m.rank, name: m.displayName, count: m.score })}</Text>
                ))}
                <Text style={styles.note}>{t('buddy.rankingNote')}</Text>
                <Text style={styles.note}>{t('buddy.rankingTies')}</Text>
              </>
            ) : (
              members.map((m) => (
                <Text key={m.memberId} style={styles.body}>{t('buddy.daysOf', { name: m.displayName, count: participationScore(m.days, from, today) })}</Text>
              ))
            )}

            {group.members.map((member) => {
              if (member.memberId === group.me.memberId) return null;
              const blockKey = `block:${member.memberId}`;
              const removeKey = `remove:${member.memberId}`;
              return (
                <View key={member.memberId} style={styles.memberRow}>
                  <Text style={styles.body}>{member.displayName}</Text>
                  <ActionButton testID={`buddy-block-${member.memberId}`} variant="link" label={t('buddy.block')} onPress={() => setConfirming(blockKey)} />
                  <ReportMember groupId={group.id} member={member} open={loaded.reporting} />
                  {confirming === blockKey ? (
                    <ActionButton testID={`buddy-block-confirm-${member.memberId}`} variant="danger" label={t('buddy.blockConfirm')} onPress={() => run(blockKey, () => blockMember(group.id, member.memberId))} />
                  ) : null}
                  {owner ? <ActionButton testID={`buddy-remove-${member.memberId}`} variant="link" label={t('buddy.remove')} onPress={() => setConfirming(removeKey)} /> : null}
                  {owner && confirming === removeKey ? (
                    <ActionButton testID={`buddy-remove-confirm-${member.memberId}`} variant="danger" label={t('buddy.removeConfirm')} onPress={() => run(removeKey, () => removeMember(group.id, member.memberId))} />
                  ) : null}
                </View>
              );
            })}

            <GroupMilestones group={group} milestones={loaded.milestones} />

            {owner ? <ActionButton testID={`buddy-invite-${group.id}`} variant="secondary" label={t('buddy.invite')} onPress={() => makeInvite(group.id)} /> : null}
            {invite?.groupId === group.id ? (
              <View accessibilityLiveRegion="polite" style={styles.invite}>
                <Text selectable style={styles.token}>{invite.token}</Text>
                <Text style={styles.note}>{t('buddy.inviteOnce')}</Text>
                <Text style={styles.note}>{t('buddy.inviteExpires', { time: new Date(invite.expiresAt).toLocaleString() })}</Text>
                <ActionButton testID={`buddy-share-${group.id}`} variant="secondary" label={t('buddy.share')} onPress={() => Share.share({ message: t('buddy.shareMessage', { token: invite.token }) })} />
              </View>
            ) : null}

            <ActionButton testID={`buddy-leave-${group.id}`} variant="link" label={t('buddy.leave')} onPress={() => setConfirming(`leave:${group.id}`)} />
            {confirming === `leave:${group.id}` ? (
              <ActionButton testID={`buddy-leave-confirm-${group.id}`} variant="danger" label={t('buddy.leaveConfirm')} onPress={() => run(`leave:${group.id}`, () => leaveGroup(group.id))} />
            ) : null}
          </SectionCard>
        );
      })}

      {loaded.groups.length > 0 ? <ActionButton testID="buddy-ranking-toggle" variant="link" label={t(ranking ? 'buddy.hideRanking' : 'buddy.showRanking')} onPress={() => setRanking((r) => !r)} /> : null}

      <SectionCard title={t('buddy.createTitle')}>
        <TextInput testID="buddy-create-name" accessibilityLabel={t('buddy.groupName')} placeholder={t('buddy.groupName')} placeholderTextColor={tokens.color.textSecondary} maxLength={40} value={create.name} onChangeText={(name) => setCreate((c) => ({ ...c, name }))} style={styles.input} />
        <TextInput testID="buddy-create-display" accessibilityLabel={t('buddy.yourName')} placeholder={t('buddy.yourName')} placeholderTextColor={tokens.color.textSecondary} maxLength={30} value={create.display} onChangeText={(display) => setCreate((c) => ({ ...c, display }))} style={styles.input} />
        <View style={styles.switchRow}>
          <Switch testID="buddy-create-disclosure" accessibilityLabel={t('buddy.acceptDisclosure')} value={create.accepted} onValueChange={(accepted) => setCreate((c) => ({ ...c, accepted }))} />
          <Text style={[styles.body, styles.switchText]}>{t('buddy.acceptDisclosure')}</Text>
        </View>
        <ActionButton testID="buddy-create-submit" label={t('buddy.create')} onPress={startGroup} />
        {create.message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{create.message}</Text> : null}
      </SectionCard>

      <SectionCard title={t('buddy.joinTitle')}>
        <TextInput testID="buddy-join-token" accessibilityLabel={t('buddy.pasteInvite')} placeholder={t('buddy.pasteInvite')} placeholderTextColor={tokens.color.textSecondary} autoCapitalize="none" autoCorrect={false} value={join.token} onChangeText={(token) => setJoin((j) => ({ ...j, token }))} style={styles.input} />
        <TextInput testID="buddy-join-display" accessibilityLabel={t('buddy.yourName')} placeholder={t('buddy.yourName')} placeholderTextColor={tokens.color.textSecondary} maxLength={30} value={join.display} onChangeText={(display) => setJoin((j) => ({ ...j, display }))} style={styles.input} />
        <View style={styles.switchRow}>
          <Switch testID="buddy-join-disclosure" accessibilityLabel={t('buddy.acceptDisclosure')} value={join.accepted} onValueChange={(accepted) => setJoin((j) => ({ ...j, accepted }))} />
          <Text style={[styles.body, styles.switchText]}>{t('buddy.acceptDisclosure')}</Text>
        </View>
        <ActionButton testID="buddy-join-submit" label={t('buddy.join')} onPress={joinGroup} />
        {join.message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{join.message}</Text> : null}
      </SectionCard>
    </ScreenFrame>
  );
}

export default withAccountKey(BuddyScreen);

const styles = StyleSheet.create({
  title: { color: tokens.color.text, fontSize: 28, lineHeight: 36, fontWeight: '700', marginBottom: tokens.space[2] },
  body: { color: tokens.color.text, fontSize: 16, lineHeight: 24, marginTop: tokens.space[1] },
  note: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginTop: tokens.space[2], marginBottom: tokens.space[2] },
  message: { color: tokens.color.warning, fontSize: 16, lineHeight: 24, marginTop: tokens.space[2] },
  memberRow: { marginTop: tokens.space[2] },
  invite: { marginTop: tokens.space[3], padding: tokens.space[3], borderRadius: tokens.radius.control, backgroundColor: tokens.color.surfaceRaised },
  token: { color: tokens.color.accent, fontSize: 16, lineHeight: 24 },
  input: { minHeight: tokens.minTap, borderRadius: tokens.radius.control, borderWidth: 1, borderColor: tokens.color.borderStrong, backgroundColor: tokens.color.surfaceRaised, color: tokens.color.text, fontSize: 16, paddingHorizontal: tokens.space[3], marginBottom: tokens.space[2] },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: tokens.minTap, marginBottom: tokens.space[2] },
  switchText: { flex: 1, marginLeft: tokens.space[2] },
});
