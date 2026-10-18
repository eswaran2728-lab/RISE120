import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { tokens } from '../theme/tokens';

// A short line about what is saved only on this phone. Shows nothing when everything is synced and online, and
// never says "verified" about cached data: it only reports what is waiting and when the last sync was.
export function SyncNotice({ pending, offline, lastSync }: { pending: number; offline: boolean; lastSync?: string | null }) {
  if (pending <= 0 && !offline) return null;
  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
      {offline ? <Text style={styles.text}>{t('states.offlineShort')}</Text> : null}
      {offline && lastSync ? <Text style={styles.text}>{t('states.lastSynced', { time: lastSync })}</Text> : null}
      {pending > 0 ? <Text style={styles.text}>{t('states.pendingSync', { count: pending })}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: tokens.color.surfaceRaised,
    borderRadius: tokens.radius.control,
    paddingHorizontal: tokens.space[3],
    paddingVertical: tokens.space[2],
    marginBottom: tokens.space[3],
  },
  text: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21 },
});
