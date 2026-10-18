import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { tokens } from '../theme/tokens';
import { ActionButton } from './ActionButton';

// What a screen shows instead of its content while that content is loading, empty, failed or only available
// from this phone. Messages are already translated by the caller; retry always retries the one failed action.
export type AsyncStateValue =
  | { kind: 'loading'; message?: string }
  | { kind: 'empty'; message: string }
  | { kind: 'error'; message: string; onRetry?: () => unknown }
  | { kind: 'offline'; lastSync?: string | null; onRetry?: () => unknown };

export function AsyncState({ state }: { state: AsyncStateValue }) {
  if (state.kind === 'loading') {
    return (
      <View style={styles.box} accessibilityLiveRegion="polite">
        <ActivityIndicator color={tokens.color.accent} size="large" />
        <Text style={styles.message}>{state.message ?? t('states.loading')}</Text>
      </View>
    );
  }
  if (state.kind === 'empty') {
    return (
      <View style={styles.box}>
        <Text style={styles.message}>{state.message}</Text>
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View style={styles.box} accessibilityRole="alert" accessibilityLiveRegion="assertive">
        <Text style={[styles.message, styles.error]}>{state.message}</Text>
        {state.onRetry ? <ActionButton label={t('errors.retry')} variant="secondary" onPress={state.onRetry} /> : null}
      </View>
    );
  }
  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
      <Text style={styles.message}>{t('states.offline')}</Text>
      {state.lastSync ? <Text style={styles.detail}>{t('states.lastSynced', { time: state.lastSync })}</Text> : null}
      {state.onRetry ? <ActionButton label={t('errors.retry')} variant="secondary" onPress={state.onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', padding: tokens.space[5], gap: tokens.space[3] },
  message: { color: tokens.color.text, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  error: { color: tokens.color.danger },
  detail: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
