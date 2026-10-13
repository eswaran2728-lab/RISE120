import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import i18next, { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { deleteAccount, signOut } from '../src/auth/authService';
import { supabase } from '../src/lib/supabase';
import { updateProfilePreference } from '../src/settings/preferences';
import { cacheUnits } from '../src/profile/cache';

const LANGUAGES = ['en', 'ms', 'ta'] as const;
const UNITS = ['metric', 'imperial'] as const;

type Language = (typeof LANGUAGES)[number];
type Units = (typeof UNITS)[number];

export default function SettingsScreen() {
  useLanguage();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const [units, setUnits] = useState<Units>('metric');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyLock = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    supabase
      .from('profiles')
      .select('units')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (alive && data?.units) setUnits(data.units as Units);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  // One action at a time; the ref blocks a second tap before state re-renders.
  const run = async (action: () => Promise<void>) => {
    if (busyLock.current) return;
    busyLock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(t('errors.generic'));
    } finally {
      busyLock.current = false;
      setBusy(false);
    }
  };

  const chooseLanguage = (language: Language) =>
    run(async () => {
      if (!userId) return;
      await updateProfilePreference(userId, { language });
      await i18next.changeLanguage(language);
    });

  const chooseUnits = (next: Units) =>
    run(async () => {
      if (!userId) return;
      await updateProfilePreference(userId, { units: next });
      await cacheUnits(userId, next);
      setUnits(next);
    });

  const confirmDelete = () => {
    Alert.alert(t('settings.deleteAccount'), t('settings.deleteConfirm'), [
      { text: t('settings.cancel'), style: 'cancel' },
      { text: t('settings.deleteAccount'), style: 'destructive', onPress: () => void run(deleteAccount) },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity accessibilityRole="button" style={styles.back} onPress={() => router.back()}>
        <Text style={styles.link}>{t('onboarding.back')}</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{t('settings.title')}</Text>

      <Text style={styles.label}>{t('settings.language')}</Text>
      {LANGUAGES.map((language) => (
        <TouchableOpacity
          key={language}
          accessibilityRole="button"
          disabled={busy}
          style={[styles.option, i18next.language === language && styles.optionSelected]}
          onPress={() => chooseLanguage(language)}
        >
          <Text style={[styles.optionText, i18next.language === language && styles.optionTextSelected]}>
            {t(`onboarding.languages.${language}`)}
          </Text>
        </TouchableOpacity>
      ))}

      <Text style={styles.label}>{t('settings.units')}</Text>
      {UNITS.map((option) => (
        <TouchableOpacity
          key={option}
          accessibilityRole="button"
          disabled={busy}
          style={[styles.option, units === option && styles.optionSelected]}
          onPress={() => chooseUnits(option)}
        >
          <Text style={[styles.optionText, units === option && styles.optionTextSelected]}>
            {t(`onboarding.unitOptions.${option}`)}
          </Text>
        </TouchableOpacity>
      ))}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        accessibilityRole="button"
        disabled={busy}
        style={[styles.button, styles.secondaryButton, busy && styles.disabled]}
        onPress={() => run(signOut)}
      >
        <Text style={styles.secondaryButtonText}>{t('settings.signOut')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        accessibilityRole="button"
        disabled={busy}
        style={[styles.button, styles.dangerButton, busy && styles.disabled]}
        onPress={confirmDelete}
      >
        {busy ? <ActivityIndicator color={DANGER} /> : <Text style={styles.dangerText}>{t('settings.deleteAccount')}</Text>}
      </TouchableOpacity>
      <View style={styles.spacer} />
    </ScrollView>
  );
}

const MUTED = '#8892A0';
const DANGER = '#FF6B6B';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[5], paddingTop: tokens.space[7] },
  back: { minHeight: tokens.minTap, justifyContent: 'center', alignSelf: 'flex-start' },
  link: { color: tokens.color.accent, fontSize: 16 },
  title: { color: tokens.color.text, fontSize: 28, fontWeight: '700', marginBottom: tokens.space[5] },
  label: { color: MUTED, fontSize: 14, marginTop: tokens.space[3], marginBottom: tokens.space[2] },
  option: {
    minHeight: tokens.minTap,
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: tokens.space[4],
    marginBottom: tokens.space[3],
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: '#2D3748',
  },
  optionSelected: { borderColor: tokens.color.accent },
  optionText: { color: tokens.color.text, fontSize: 16 },
  optionTextSelected: { color: tokens.color.accent, fontWeight: '600' },
  errorText: { color: DANGER, marginVertical: tokens.space[2] },
  button: {
    minHeight: tokens.minTap,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: tokens.space[4],
  },
  secondaryButton: { backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: '#2D3748' },
  secondaryButtonText: { color: tokens.color.text, fontSize: 16 },
  dangerButton: { borderWidth: 1, borderColor: DANGER },
  dangerText: { color: DANGER, fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  spacer: { height: tokens.space[6] },
});
