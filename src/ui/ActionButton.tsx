import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { tokens } from '../theme/tokens';

export type ActionVariant = 'primary' | 'secondary' | 'link' | 'danger';

interface Props {
  label: string; // always visible text: there is no icon-only button
  onPress: () => unknown;
  busy?: boolean;
  disabled?: boolean;
  variant?: ActionVariant;
  // Called with whatever an async action throws. Without it the error is rethrown, never swallowed.
  onError?: (error: unknown) => void;
  testID?: string;
}

// One press at a time: while an async action runs (or busy/disabled is set) further presses are ignored, so a
// double tap cannot send, buy or save twice.
export function ActionButton({ label, onPress, busy = false, disabled = false, variant = 'primary', onError, testID }: Props) {
  const [running, setRunning] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const isBusy = busy || running;
  const inactive = isBusy || disabled;

  const handlePress = async () => {
    if (inactive || locked.current) return;
    locked.current = true;
    try {
      const result = onPress();
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        setRunning(true);
        await result;
      }
    } catch (error) {
      if (!onError) throw error;
      onError(error);
    } finally {
      locked.current = false;
      if (mounted.current) setRunning(false);
    }
  };

  const textColor = textColors[variant];
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: isBusy }}
      disabled={inactive}
      style={[styles.base, variantStyles[variant], inactive && styles.inactive]}
      onPress={handlePress}
    >
      {isBusy ? <ActivityIndicator accessibilityRole="progressbar" size="small" color={textColor} style={styles.spinner} /> : null}
      <Text style={[styles.label, { color: textColor }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const textColors = {
  primary: tokens.color.onAccent,
  secondary: tokens.color.text,
  link: tokens.color.accent,
  danger: tokens.color.danger,
};

const styles = StyleSheet.create({
  base: {
    minHeight: tokens.minTap,
    borderRadius: tokens.radius.control,
    paddingHorizontal: tokens.space[4],
    paddingVertical: tokens.space[2],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 16, lineHeight: 24, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  spinner: { marginRight: tokens.space[2] },
  inactive: { opacity: 0.6 },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: tokens.color.accent },
  secondary: { borderWidth: 1, borderColor: tokens.color.borderStrong },
  link: { justifyContent: 'flex-start', paddingHorizontal: 0 },
  danger: { borderWidth: 1, borderColor: tokens.color.danger },
});
