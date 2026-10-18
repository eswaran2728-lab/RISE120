import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Href, useLocalSearchParams, useRouter } from 'expo-router';
import { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { createCustomFood, CustomFoodError, deleteCustomFood, getOwnCustomFood, updateCustomFood } from '../src/food/custom';
import type { FoodFields } from '../src/food/types';
import type { FoodField } from '../src/food/validation';

const EMPTY: FoodFields = { name: '', servingDesc: '', calories: '', protein: '', carbs: '', fat: '' };

export default function FoodEditScreen() {
  useLanguage();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = typeof id === 'string' && id !== '';

  const [fields, setFields] = useState<FoodFields>(EMPTY);
  const [ready, setReady] = useState(!editing);
  const [errors, setErrors] = useState<Partial<Record<FoodField, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing || !userId) return;
    let alive = true;
    getOwnCustomFood(userId, id as string)
      .then((food) => {
        if (!alive) return;
        if (food) {
          setFields({
            name: food.name,
            servingDesc: food.servingDesc,
            calories: String(food.calories),
            protein: String(food.proteinG),
            carbs: String(food.carbsG),
            fat: String(food.fatG),
          });
        } else {
          setMessage(t('food.custom.notFound'));
        }
        setReady(true);
      })
      .catch(() => {
        if (alive) {
          setMessage(t('errors.generic'));
          setReady(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [editing, id, userId]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/today' as Href);
  };

  const save = async () => {
    if (!userId || busy) return;
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      if (editing) await updateCustomFood(userId, id as string, fields);
      else await createCustomFood(userId, fields);
      goBack();
    } catch (error) {
      if (error instanceof CustomFoodError && error.code === 'invalid' && error.field) {
        const text =
          error.reason === 'required' ? t('food.custom.required') : t(error.reason === 'max' ? 'onboarding.errors.tooHigh' : 'onboarding.errors.number');
        setErrors({ [error.field]: text });
      } else if (error instanceof CustomFoodError && error.code === 'not_found') {
        setMessage(t('food.custom.notFound'));
      } else if (error instanceof CustomFoodError && error.code === 'in_use') {
        setMessage(t('food.custom.inUseEdit'));
      } else {
        setMessage(t('errors.generic'));
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(t('food.custom.delete'), t('food.custom.deleteConfirm'), [
      { text: t('settings.cancel'), style: 'cancel' },
      {
        text: t('food.custom.delete'),
        style: 'destructive',
        onPress: async () => {
          if (!userId || busy) return;
          setBusy(true);
          setMessage(null);
          try {
            await deleteCustomFood(userId, id as string);
            goBack();
          } catch (error) {
            setMessage(error instanceof CustomFoodError && error.code === 'in_use' ? t('food.custom.inUse') : t('errors.generic'));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const field = (key: FoodField, label: string, numeric: boolean) => (
    <View style={styles.field} key={key}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label}
        style={styles.input}
        value={fields[key]}
        onChangeText={(text) => setFields((current) => ({ ...current, [key]: text }))}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        placeholderTextColor={MUTED}
      />
      {errors[key] ? <Text style={styles.errorText}>{errors[key]}</Text> : null}
    </View>
  );

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.color.accent} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t(editing ? 'food.custom.editTitle' : 'food.custom.createTitle')}</Text>
        <Text style={styles.note}>{t('food.custom.note')}</Text>

        {field('name', t('food.custom.name'), false)}
        {field('servingDesc', t('food.custom.serving'), false)}
        {field('calories', t('food.custom.calories'), true)}
        {field('protein', t('food.custom.protein'), true)}
        {field('carbs', t('food.custom.carbs'), true)}
        {field('fat', t('food.custom.fat'), true)}

        {message ? <Text style={styles.errorText}>{message}</Text> : null}

        <TouchableOpacity accessibilityRole="button" style={[styles.button, busy && styles.disabled]} disabled={busy} onPress={save}>
          {busy ? <ActivityIndicator color={tokens.color.bg} /> : <Text style={styles.buttonText}>{t('food.custom.save')}</Text>}
        </TouchableOpacity>

        {editing ? (
          <TouchableOpacity accessibilityRole="button" style={[styles.deleteButton, busy && styles.disabled]} disabled={busy} onPress={confirmDelete}>
            <Text style={styles.deleteText}>{t('food.custom.delete')}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const MUTED = tokens.color.textSecondary;
const DANGER = tokens.color.danger;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[5], paddingTop: tokens.space[7], paddingBottom: tokens.space[7] },
  center: { flex: 1, backgroundColor: tokens.color.bg, alignItems: 'center', justifyContent: 'center' },
  title: { color: tokens.color.text, fontSize: 28, fontWeight: '700', marginBottom: tokens.space[2] },
  note: { color: MUTED, fontSize: 13, lineHeight: 18, marginBottom: tokens.space[3] },
  field: { marginBottom: tokens.space[2] },
  label: { color: MUTED, fontSize: 14, marginBottom: tokens.space[1], marginTop: tokens.space[2] },
  input: { backgroundColor: tokens.color.surface, color: tokens.color.text, borderRadius: 8, paddingHorizontal: tokens.space[4], minHeight: tokens.minTap, fontSize: 16 },
  errorText: { color: DANGER, marginTop: tokens.space[1] },
  button: { minHeight: tokens.minTap, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[4], backgroundColor: tokens.color.accent },
  buttonText: { color: tokens.color.bg, fontWeight: '600', fontSize: 16 },
  deleteButton: { minHeight: tokens.minTap, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[3], borderWidth: 1, borderColor: DANGER },
  deleteText: { color: DANGER, fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.5 },
});
