import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { t } from '../i18n';
import { tokens } from '../theme/tokens';
import { foodNutrition } from '../food/nutrition';
import { foodSourceLabel, formatServing } from '../food/summary';
import { Food, MEAL_TYPES, MealType } from '../food/types';
import { parseQuantity } from '../food/validation';

interface Props {
  food: Food;
  initialQuantity?: string;
  initialMeal: MealType;
  submitLabelKey: string; // 'food.entry.add' or 'food.entry.save'
  busy: boolean;
  error: string | null;
  onSubmit: (quantity: number, meal: MealType) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// Choose how many listed servings and which meal. Shows the serving size, the source and whether
// the food is verified, and what this entry adds, so the numbers are never a surprise.
export function FoodEntry({ food, initialQuantity = '1', initialMeal, submitLabelKey, busy, error, onSubmit, onCancel, onDelete }: Props) {
  const [quantityText, setQuantityText] = useState(initialQuantity);
  const [meal, setMeal] = useState<MealType>(initialMeal);
  const parsed = parseQuantity(quantityText);
  const source = foodSourceLabel(food);
  const total = parsed.ok ? foodNutrition(food, parsed.quantity) : null;

  const quantityError = parsed.ok
    ? null
    : t(parsed.reason === 'required' || parsed.reason === 'invalid' ? 'onboarding.errors.number' : 'onboarding.errors.tooHigh');

  return (
    <View style={styles.container}>
      <Text style={styles.name}>{food.name}</Text>
      <Text style={styles.meta}>{`${t(source.key)}${source.verified ? ` · ${t('food.verified')}` : ''}`}</Text>
      <Text style={styles.meta}>{`${t('food.perServing')}: ${food.servingDesc}`}</Text>
      <Text style={styles.meta}>{`${round1(food.calories)} ${t('today.kcal')} · ${t('food.protein')} ${round1(food.proteinG)} g · ${t('food.carbs')} ${round1(food.carbsG)} g · ${t('food.fat')} ${round1(food.fatG)} g`}</Text>

      <Text style={styles.label}>{t('food.entry.servings')}</Text>
      <TextInput style={styles.input} value={quantityText} onChangeText={setQuantityText} keyboardType="decimal-pad" selectTextOnFocus />
      {quantityError ? <Text style={styles.errorText}>{quantityError}</Text> : null}
      {total && parsed.ok ? (
        <Text style={styles.total}>{`${t('food.entry.total')}: ${formatServing(parsed.quantity, food.servingDesc)} = ${round1(total.calories)} ${t('today.kcal')}`}</Text>
      ) : null}

      <Text style={styles.label}>{t('food.entry.meal')}</Text>
      <View style={styles.row}>
        {MEAL_TYPES.map((type) => (
          <TouchableOpacity key={type} accessibilityRole="button" style={[styles.chip, meal === type && styles.chipSelected]} onPress={() => setMeal(type)}>
            <Text style={[styles.chipText, meal === type && styles.chipTextSelected]}>{t(`food.meals.${type}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.button, (!parsed.ok || busy) && styles.disabled]}
        disabled={!parsed.ok || busy}
        onPress={() => parsed.ok && onSubmit(parsed.quantity, meal)}
      >
        {busy ? <ActivityIndicator color={tokens.color.bg} /> : <Text style={styles.buttonText}>{t(submitLabelKey)}</Text>}
      </TouchableOpacity>

      {onDelete ? (
        <TouchableOpacity accessibilityRole="button" style={[styles.deleteButton, busy && styles.disabled]} disabled={busy} onPress={onDelete}>
          <Text style={styles.deleteText}>{t('food.remove')}</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity accessibilityRole="button" style={styles.cancel} onPress={onCancel} disabled={busy}>
        <Text style={styles.cancelText}>{t('settings.cancel')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const MUTED = '#8892A0';
const DANGER = '#FF6B6B';

const styles = StyleSheet.create({
  container: { backgroundColor: tokens.color.surface, borderRadius: 8, padding: tokens.space[4] },
  name: { color: tokens.color.text, fontSize: 20, fontWeight: '700' },
  meta: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: tokens.space[1] },
  label: { color: MUTED, fontSize: 14, marginTop: tokens.space[3], marginBottom: tokens.space[1] },
  input: { backgroundColor: tokens.color.bg, color: tokens.color.text, borderRadius: 8, paddingHorizontal: tokens.space[4], minHeight: tokens.minTap, fontSize: 16 },
  total: { color: tokens.color.accent, fontSize: 14, marginTop: tokens.space[2] },
  errorText: { color: DANGER, marginTop: tokens.space[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[2] },
  chip: { minHeight: tokens.minTap, paddingHorizontal: tokens.space[3], borderRadius: 8, justifyContent: 'center', borderWidth: 1, borderColor: '#2D3748' },
  chipSelected: { borderColor: tokens.color.accent },
  chipText: { color: tokens.color.text },
  chipTextSelected: { color: tokens.color.accent, fontWeight: '600' },
  button: { minHeight: tokens.minTap, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[4], backgroundColor: tokens.color.accent },
  buttonText: { color: tokens.color.bg, fontWeight: '600', fontSize: 16 },
  deleteButton: { minHeight: tokens.minTap, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[2], borderWidth: 1, borderColor: DANGER },
  deleteText: { color: DANGER, fontWeight: '600' },
  cancel: { minHeight: tokens.minTap, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[1] },
  cancelText: { color: MUTED, fontSize: 16 },
  disabled: { opacity: 0.5 },
});
