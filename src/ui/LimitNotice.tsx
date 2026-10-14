import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { t } from '../i18n';
import { tokens } from '../theme/tokens';
import type { UnlockAction } from '../monetization/limits';

interface Props {
  title?: string;
  body: string;
  detail?: string | null; // for example when the limit resets
  actions: UnlockAction[];
  onAction?: (action: UnlockAction) => void;
  busy?: boolean; // an action is running; the buttons wait
  message?: string | null; // the outcome of the last action
}

const ACTION_LABELS: Record<UnlockAction, string> = { subscribe: 'limits.subscribe', watch_ad: 'limits.watchAd' };

// A limit or lock explained, with the actions that could lift it. The actions only start the flows; whether
// anything unlocks is decided by the server and shown by the next refresh of the limits.
export function LimitNotice({ title, body, detail, actions, onAction, busy = false, message }: Props) {
  return (
    <View style={styles.box}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Text style={styles.body}>{body}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <TouchableOpacity
              key={action}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || !onAction }}
              disabled={busy || !onAction}
              style={[styles.action, (busy || !onAction) && styles.dim]}
              onPress={() => onAction?.(action)}
            >
              <Text style={styles.actionText}>{t(ACTION_LABELS[action])}</Text>
            </TouchableOpacity>
          ))}
          {busy ? <ActivityIndicator color={tokens.color.accent} /> : null}
        </View>
      ) : null}
      {busy ? <Text style={styles.detail}>{t('limits.working')}</Text> : null}
      {message ? <Text style={styles.detail}>{message}</Text> : null}
    </View>
  );
}

const MUTED = '#8892A0';

const styles = StyleSheet.create({
  box: { backgroundColor: tokens.color.surface, borderRadius: 8, padding: tokens.space[4], marginTop: tokens.space[3], borderWidth: 1, borderColor: '#2D3748' },
  title: { color: tokens.color.text, fontSize: 18, fontWeight: '600', marginBottom: tokens.space[1] },
  body: { color: tokens.color.text, fontSize: 15, lineHeight: 21 },
  detail: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: tokens.space[2] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2], marginTop: tokens.space[3], flexWrap: 'wrap' },
  action: { minHeight: tokens.minTap, borderRadius: 8, borderWidth: 1, borderColor: tokens.color.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: tokens.space[4] },
  dim: { opacity: 0.5 },
  actionText: { color: tokens.color.accent, fontSize: 15, fontWeight: '600' },
});
