import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Href, useRouter } from 'expo-router';
import { t } from '../../src/i18n';
import { useLanguage } from '../../src/i18n/useLanguage';
import { tokens } from '../../src/theme/tokens';

export default function TodayScreen() {
  useLanguage();
  const router = useRouter();
  return (
    <View style={styles.container}>
      <TouchableOpacity
        accessibilityRole="button"
        style={styles.settingsLink}
        onPress={() => router.push('/settings' as Href)}
      >
        <Text style={styles.settingsText}>{t('settings.title')}</Text>
      </TouchableOpacity>
      <Text style={styles.text}>{t('today.preparing')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.color.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.space[5],
  },
  settingsLink: {
    position: 'absolute',
    top: tokens.space[7],
    right: tokens.space[5],
    minHeight: tokens.minTap,
    justifyContent: 'center',
  },
  settingsText: { color: tokens.color.accent, fontSize: 16 },
  text: { color: tokens.color.text, fontSize: 20, textAlign: 'center' },
});
