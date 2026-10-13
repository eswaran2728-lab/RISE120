import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Href, useRouter } from 'expo-router';
import { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { notifyPlanInputsSaved } from '../src/onboarding/completion';
import { ActivityLevel, EnergySex, savePlanInputs } from '../src/onboarding/planInputs';

const SEX_OPTIONS: readonly EnergySex[] = ['male', 'female', 'undisclosed'];
const ACTIVITY_OPTIONS: readonly ActivityLevel[] = ['sedentary', 'light', 'active'];

export default function PlanInputsScreen() {
  useLanguage();
  const router = useRouter();
  const { session } = useSession();
  const [energySex, setEnergySex] = useState<EnergySex | null>(null);
  const [activityLevel, setActivityLevel] = useState<ActivityLevel | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const userId = session?.user?.id;
    if (!userId || !energySex || !activityLevel || saving) return;
    setSaving(true);
    setError(null);
    try {
      await savePlanInputs(userId, { energySex, activityLevel });
      notifyPlanInputsSaved();
      router.replace('/(tabs)/today' as Href);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  const group = <T extends string>(values: readonly T[], selected: T | null, keyPrefix: string, onPick: (v: T) => void) =>
    values.map((value) => (
      <TouchableOpacity
        key={value}
        accessibilityRole="button"
        style={[styles.option, selected === value && styles.optionSelected]}
        onPress={() => onPick(value)}
      >
        <Text style={[styles.optionText, selected === value && styles.optionTextSelected]}>{t(`${keyPrefix}.${value}`)}</Text>
      </TouchableOpacity>
    ));

  const disabled = !energySex || !activityLevel || saving;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('planInputs.title')}</Text>
      <Text style={styles.explain}>{t('planInputs.explain')}</Text>

      <Text style={styles.label}>{t('planInputs.sexLabel')}</Text>
      {group(SEX_OPTIONS, energySex, 'planInputs.sexOptions', setEnergySex)}

      <Text style={styles.label}>{t('planInputs.activityLabel')}</Text>
      {group(ACTIVITY_OPTIONS, activityLevel, 'planInputs.activityOptions', setActivityLevel)}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.button, disabled && styles.disabled]}
        disabled={disabled}
        onPress={save}
      >
        {saving ? <ActivityIndicator color={tokens.color.bg} /> : <Text style={styles.buttonText}>{t('planInputs.save')}</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const MUTED = '#8892A0';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[5], paddingTop: tokens.space[7] },
  title: { color: tokens.color.text, fontSize: 28, fontWeight: '700', marginBottom: tokens.space[3] },
  explain: { color: MUTED, fontSize: 14, marginBottom: tokens.space[4], lineHeight: 20 },
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
  errorText: { color: '#FF6B6B', marginVertical: tokens.space[2] },
  button: {
    minHeight: tokens.minTap,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: tokens.space[4],
    backgroundColor: tokens.color.accent,
  },
  buttonText: { color: tokens.color.bg, fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.5 },
});
