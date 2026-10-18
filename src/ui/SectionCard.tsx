import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { tokens } from '../theme/tokens';

// A rounded card. Midnight by default; the gold tone is for the single most important card on a screen.
export function SectionCard({ title, tone = 'default', children, testID }: { title?: string; tone?: 'default' | 'accent'; children?: React.ReactNode; testID?: string }) {
  const accent = tone === 'accent';
  return (
    <View testID={testID} style={[styles.card, accent ? styles.accent : styles.default]}>
      {title ? (
        <Text accessibilityRole="header" style={[styles.title, { color: accent ? tokens.color.onAccent : tokens.color.text }]}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: tokens.radius.card, padding: tokens.space[4], marginBottom: tokens.space[4] },
  default: { backgroundColor: tokens.color.surface, borderColor: tokens.color.border, borderWidth: 1 },
  accent: { backgroundColor: tokens.color.accent },
  title: { fontSize: 18, lineHeight: 27, fontWeight: '600', marginBottom: tokens.space[1] },
});
