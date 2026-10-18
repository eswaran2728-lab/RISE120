import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { tokens } from '../theme/tokens';

// The frame around a screen: page colour, 16-point margins, and scrolling that keeps buttons tappable while the
// keyboard is open. It holds no business logic. A screen that owns a list passes scroll={false}.
export function ScreenFrame({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  return (
    <View style={styles.page}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {scroll ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.flex, styles.content]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: tokens.color.bg },
  flex: { flex: 1 },
  content: { padding: tokens.space[4], paddingTop: tokens.space[6], paddingBottom: tokens.space[6] },
});
