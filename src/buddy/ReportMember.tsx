import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '../i18n';
import { randomId } from '../lib/randomId';
import { tokens } from '../theme/tokens';
import { ActionButton } from '../ui/ActionButton';
import { submitReport } from './api';
import { MESSAGE } from './messages';
import type { BuddyMember, ReportReason } from './types';

const REASONS: ReportReason[] = ['harassment', 'spam', 'unsafe', 'other'];

// Report another member of the group. Reports go to a restricted review; there is no public chat and the member is not
// told. When reporting is not open (nobody is set up to review reports) this says so plainly and sends nothing.
export function ReportMember({ groupId, member, open }: { groupId: string; member: BuddyMember; open: boolean }) {
  const [step, setStep] = useState<'idle' | 'form' | 'closed' | 'done'>('idle');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  const sending = useRef(false);
  const request = useRef<string | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const send = async () => {
    if (sending.current) return;
    if (!reason) return setMessage(t('buddy.reportNeedReason'));
    sending.current = true;
    try {
      request.current ??= randomId();
      const result = await submitReport({ groupId, memberId: member.memberId, reason, note: note.trim() === '' ? null : note.trim(), requestId: request.current });
      if (!alive.current) return;
      if (result.kind === 'ok') {
        request.current = null;
        setStep('done');
        setMessage(t('buddy.reportReceived', { reference: result.reportId }));
      } else if (result.kind === 'reporting_unavailable') {
        setStep('closed');
        setMessage(null);
      } else {
        if (result.kind !== 'offline' && result.kind !== 'error') request.current = null;
        setMessage(t(MESSAGE[result.kind]));
      }
    } finally {
      sending.current = false;
    }
  };

  return (
    <View>
      {step === 'idle' ? <ActionButton testID={`buddy-report-${member.memberId}`} variant="link" label={t('buddy.report')} onPress={() => setStep(open ? 'form' : 'closed')} /> : null}
      {step === 'closed' ? <Text accessibilityLiveRegion="polite" style={styles.note}>{t('buddy.reportClosed')}</Text> : null}
      {step === 'form' ? (
        <View style={styles.form}>
          <Text style={styles.body}>{t('buddy.reportWhy', { name: member.displayName })}</Text>
          {REASONS.map((r) => (
            <ActionButton key={r} testID={`buddy-report-reason-${member.memberId}-${r}`} variant={reason === r ? 'primary' : 'secondary'} label={t(`buddy.reportReason.${r}`)} onPress={() => setReason(r)} />
          ))}
          <TextInput
            testID={`buddy-report-note-${member.memberId}`}
            accessibilityLabel={t('buddy.reportNote')}
            placeholder={t('buddy.reportNote')}
            placeholderTextColor={tokens.color.textSecondary}
            maxLength={300}
            multiline
            value={note}
            onChangeText={setNote}
            style={styles.input}
          />
          <ActionButton testID={`buddy-report-send-${member.memberId}`} label={t('buddy.reportSend')} onPress={send} />
          <ActionButton
            variant="link"
            label={t('buddy.reportCancel')}
            onPress={() => {
              setStep('idle');
              setMessage(null);
            }}
          />
        </View>
      ) : null}
      {message ? <Text accessibilityLiveRegion="polite" style={step === 'done' ? styles.note : styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { marginTop: tokens.space[2], padding: tokens.space[3], borderRadius: tokens.radius.control, backgroundColor: tokens.color.surfaceRaised },
  body: { color: tokens.color.text, fontSize: 16, lineHeight: 24, marginBottom: tokens.space[2] },
  note: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginTop: tokens.space[2] },
  message: { color: tokens.color.warning, fontSize: 16, lineHeight: 24, marginTop: tokens.space[2] },
  input: { minHeight: tokens.minTap, borderRadius: tokens.radius.control, borderWidth: 1, borderColor: tokens.color.borderStrong, backgroundColor: tokens.color.surface, color: tokens.color.text, fontSize: 16, padding: tokens.space[3], marginVertical: tokens.space[2] },
});
