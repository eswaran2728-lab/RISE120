import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../../src/i18n';
import { tokens } from '../../src/theme/tokens';

export default function TodayScreen() {
  return (
    <View style={styles.container}>
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
  text: { color: tokens.color.text, fontSize: 20, textAlign: 'center' },
});
