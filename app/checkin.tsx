import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Href, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { supabase } from '../src/lib/supabase';
import { localDateString } from '../src/lib/dates';
import { lbFromKg } from '../src/onboarding/units';
import { MOOD_MAX, MOOD_MIN, parseCheckinFields, queueCheckin } from '../src/checkin/checkin';
import { loadCheckin } from '../src/checkin/load';
import { saveLocalPhoto } from '../src/checkin/photos';
import { flushPending } from '../src/sync/flush';
import { supabaseTransport } from '../src/sync/supabaseTransport';

const MOODS = Array.from({ length: MOOD_MAX - MOOD_MIN + 1 }, (_, i) => MOOD_MIN + i);
const round1 = (n: number) => Math.round(n * 10) / 10;

type FieldErrors = Partial<Record<'weight' | 'sleep' | 'mood', string>>;

export default function CheckinScreen() {
  useLanguage();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const today = localDateString();
  const [ready, setReady] = useState(false);
  const [units, setUnits] = useState<'metric' | 'imperial'>('metric');
  const [weightText, setWeightText] = useState('');
  const [sleepText, setSleepText] = useState('');
  const [mood, setMood] = useState<number | null>(null);
  const [newPhotoUri, setNewPhotoUri] = useState<string | null>(null);
  const [hasSavedPhoto, setHasSavedPhoto] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    (async () => {
      let profile: { data: { units?: string } | null } | null = null;
      try {
        profile = await supabase.from('profiles').select('units').eq('id', userId).maybeSingle();
      } catch {
        // Offline: fall back to metric.
      }
      const existing = await loadCheckin(userId, today);
      if (!alive) return;
      const imperial = profile?.data?.units === 'imperial';
      if (imperial) setUnits('imperial');
      if (existing) {
        if (existing.weightKg !== null) setWeightText(String(imperial ? round1(lbFromKg(existing.weightKg)) : existing.weightKg));
        if (existing.sleepHours !== null) setSleepText(String(existing.sleepHours));
        setMood(existing.mood);
        setHasSavedPhoto(!!existing.photoPath);
        setNewPhotoUri(existing.photoUri ?? null);
      }
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [userId, today]);

  const pickPhoto = async () => {
    if (!userId) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    try {
      setNewPhotoUri(await saveLocalPhoto(userId, today, result.assets[0].uri));
    } catch {
      setSaveError(t('errors.generic'));
    }
  };

  const save = async () => {
    if (!userId || saving) return;
    const parsed = parseCheckinFields({ weight: weightText, sleep: sleepText, mood, units });
    if (!parsed.ok) {
      const message = t(parsed.reason === 'invalid' ? 'onboarding.errors.number' : parsed.reason === 'min' ? 'onboarding.errors.tooLow' : 'onboarding.errors.tooHigh');
      setErrors({ [parsed.field]: message });
      return;
    }
    setErrors({});
    setSaving(true);
    setSaveError(null);
    try {
      await queueCheckin(userId, today, { weight: weightText, sleep: sleepText, mood, units, photoUri: newPhotoUri });
      void flushPending(userId, supabaseTransport).catch(() => undefined);
      router.replace('/(tabs)/today' as Href);
    } catch {
      setSaveError(t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.color.accent} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('checkin.title')}</Text>

      <Text style={styles.label}>{t(units === 'imperial' ? 'checkin.weightLb' : 'checkin.weightKg')}</Text>
      <TextInput style={styles.input} value={weightText} onChangeText={setWeightText} keyboardType="decimal-pad" />
      {errors.weight ? <Text style={styles.errorText}>{errors.weight}</Text> : null}

      <Text style={styles.label}>{t('checkin.sleep')}</Text>
      <TextInput style={styles.input} value={sleepText} onChangeText={setSleepText} keyboardType="decimal-pad" />
      {errors.sleep ? <Text style={styles.errorText}>{errors.sleep}</Text> : null}

      <Text style={styles.label}>{t('checkin.mood')}</Text>
      <View style={styles.row}>
        {MOODS.map((value) => (
          <TouchableOpacity
            key={value}
            accessibilityRole="button"
            style={[styles.moodChip, mood === value && styles.moodChipSelected]}
            onPress={() => setMood(value)}
          >
            <Text style={[styles.moodText, mood === value && styles.moodTextSelected]}>{value}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.hint}>{t('checkin.moodScale')}</Text>
      {errors.mood ? <Text style={styles.errorText}>{errors.mood}</Text> : null}

      <TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={pickPhoto}>
        <Text style={styles.secondaryText}>{t(newPhotoUri || hasSavedPhoto ? 'checkin.changePhoto' : 'checkin.addPhoto')}</Text>
      </TouchableOpacity>
      {newPhotoUri ? <Image source={{ uri: newPhotoUri }} style={styles.preview} /> : null}
      {newPhotoUri ? <Text style={styles.hint}>{t('checkin.photoPending')}</Text> : null}
      {!newPhotoUri && hasSavedPhoto ? <Text style={styles.hint}>{t('checkin.photoSaved')}</Text> : null}
      <Text style={styles.hint}>{t('checkin.photoPrivate')}</Text>

      {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}

      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.button, saving && styles.disabled]}
        disabled={saving}
        onPress={save}
      >
        {saving ? <ActivityIndicator color={tokens.color.bg} /> : <Text style={styles.buttonText}>{t('checkin.save')}</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const MUTED = '#8892A0';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[5], paddingTop: tokens.space[7] },
  center: { flex: 1, backgroundColor: tokens.color.bg, alignItems: 'center', justifyContent: 'center' },
  title: { color: tokens.color.text, fontSize: 28, fontWeight: '700', marginBottom: tokens.space[4] },
  label: { color: MUTED, fontSize: 14, marginTop: tokens.space[3], marginBottom: tokens.space[2] },
  input: { backgroundColor: tokens.color.surface, color: tokens.color.text, borderRadius: 8, paddingHorizontal: tokens.space[4], minHeight: tokens.minTap, fontSize: 16 },
  row: { flexDirection: 'row', gap: tokens.space[2] },
  moodChip: { flex: 1, minHeight: tokens.minTap, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: '#2D3748' },
  moodChipSelected: { borderColor: tokens.color.accent },
  moodText: { color: tokens.color.text, fontSize: 18 },
  moodTextSelected: { color: tokens.color.accent, fontWeight: '700' },
  hint: { color: MUTED, fontSize: 13, marginTop: tokens.space[2], lineHeight: 18 },
  errorText: { color: '#FF6B6B', marginTop: tokens.space[2] },
  secondaryButton: { minHeight: tokens.minTap, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[5], backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: '#2D3748' },
  secondaryText: { color: tokens.color.text, fontSize: 16 },
  preview: { width: '100%', height: 200, borderRadius: 8, marginTop: tokens.space[3] },
  button: { minHeight: tokens.minTap, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[5], backgroundColor: tokens.color.accent },
  buttonText: { color: tokens.color.bg, fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.5 },
});
