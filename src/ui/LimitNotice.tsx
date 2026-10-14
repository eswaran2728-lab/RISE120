import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { t } from '../i18n';
import { tokens } from '../theme/tokens';
import type { UnlockAction } from '../monetization/limits';

interface Props {
  title?: string;
  body: string;
  detail?: string | null; // for example when the limit resets
  actions: UnlockAction[];
}

const ACTION_LABELS: Record<UnlockAction, string> = { subscribe: 'limits.subscribe', watch_ad: 'limits.watchAd' };

// A limit or lock explained, with the actions that could lift it. The actions are shown disabled until the
// purchase and rewarded-ad flows exist (Phase 4 Task 6), so nothing here pretends to work yet.
export function LimitNotice({ title, body, detail, actions }: Props) {
  return (
    <View style={styles.box}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Text style={styles.body}>{body}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      {actions.length > 0 ? (
        <>
          <View style={styles.actions}>
            {actions.map((action) => (
              <TouchableOpacity key={action} accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={styles.action}>
                <Text style={styles.actionText}>{t(ACTION_LABELS[action])}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.detail}>{t('limits.unlockSoon')}</Text>
        </>
      ) : null}
    </View>
  );
}

const MUTED = '#8892A0';

const styles = StyleSheet.create({
  box: { backgroundColor: tokens.color.surface, borderRadius: 8, padding: tokens.space[4], marginTop: tokens.space[3], borderWidth: 1, borderColor: '#2D3748' },
  title: { color: tokens.color.text, fontSize: 18, fontWeight: '600', marginBottom: tokens.space[1] },
  body: { color: tokens.color.text, fontSize: 15, lineHeight: 21 },
  detail: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: tokens.space[2] },
  actions: { flexDirection: 'row', gap: tokens.space[2], marginTop: tokens.space[3], flexWrap: 'wrap' },
  action: { minHeight: tokens.minTap, borderRadius: 8, borderWidth: 1, borderColor: '#2D3748', alignItems: 'center', justifyContent: 'center', paddingHorizontal: tokens.space[4], opacity: 0.5 },
  actionText: { color: tokens.color.text, fontSize: 15, fontWeight: '600' },
});
