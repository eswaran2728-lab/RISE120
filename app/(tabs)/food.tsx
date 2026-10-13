import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Href, useFocusEffect, useRouter } from 'expo-router';
import { t } from '../../src/i18n';
import { useLanguage } from '../../src/i18n/useLanguage';
import { tokens } from '../../src/theme/tokens';
import { useSession } from '../../src/auth/useSession';
import { useLocalDate } from '../../src/lib/useLocalDate';
import { loadPlanBundle } from '../../src/plan/planData';
import { getPlanDay } from '../../src/today/selectors';
import { flushPending } from '../../src/sync/flush';
import { supabaseTransport } from '../../src/sync/supabaseTransport';
import { FoodDay, FoodDayEntry } from '../../src/food/day';
import { queueFoodLog, queueFoodLogDelete } from '../../src/food/log';
import { loadFoodDay } from '../../src/food/loadDay';
import { foodDaySummary, foodSourceLabel, formatServing } from '../../src/food/summary';
import { MEAL_TYPES, MealType, TargetsLike } from '../../src/food/types';
import { FoodEntry } from '../../src/ui/FoodEntry';

const round1 = (n: number) => Math.round(n * 10) / 10;

export default function FoodScreen() {
  useLanguage();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const date = useLocalDate(); // rolls over at midnight and on resume, then the day reloads
  const mounted = useRef(true);
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState<FoodDay | null>(null);
  const [targets, setTargets] = useState<TargetsLike>({ calories: null, proteinG: null });
  const [editing, setEditing] = useState<FoodDayEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const [foodDay, bundle] = await Promise.all([loadFoodDay(userId, date), loadPlanBundle(userId).catch(() => null)]);
    if (!mounted.current) return;
    const planDay = bundle ? getPlanDay(bundle.plan, bundle.days, date) : null;
    setTargets({ calories: planDay?.calorieTarget ?? null, proteinG: planDay?.proteinTargetG ?? null });
    setDay(foodDay);
    setLoading(false);
  }, [userId, date]);

  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      setEditing(null);
      void load().catch(() => mounted.current && setLoading(false));
      return () => {
        mounted.current = false;
      };
    }, [load])
  );

  const syncThenReload = () => {
    if (!userId) return;
    void flushPending(userId, supabaseTransport)
      .then(load)
      .catch(() => undefined);
  };

  const saveEdit = async (quantity: number, meal: MealType) => {
    if (!userId || !editing?.food || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Same id: the edit replaces the earlier entry, so totals change once.
      await queueFoodLog(userId, editing.date, { id: editing.id, food: editing.food, quantity, mealType: meal });
      setEditing(null);
      await load();
      syncThenReload();
    } catch {
      setError(t('food.entry.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const removeEntry = async () => {
    if (!userId || !editing || busy) return;
    setBusy(true);
    setError(null);
    try {
      await queueFoodLogDelete(userId, editing);
      setEditing(null);
      await load();
      syncThenReload();
    } catch {
      setError(t('food.entry.saveError'));
    } finally {
      setBusy(false);
    }
  };

  if (loading || !day) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.color.accent} size="large" />
      </View>
    );
  }

  const summary = foodDaySummary(day, targets);

  if (editing) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {editing.food ? (
          <FoodEntry
            food={editing.food}
            initialQuantity={String(editing.quantity)}
            initialMeal={editing.mealType}
            submitLabelKey="food.entry.save"
            busy={busy}
            error={error}
            onSubmit={saveEdit}
            onCancel={() => setEditing(null)}
            onDelete={removeEntry}
          />
        ) : (
          <View style={styles.card}>
            <Text style={styles.meta}>{t('food.unavailable')}</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.deleteButton} onPress={removeEntry} disabled={busy}>
              <Text style={styles.deleteText}>{t('food.remove')}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={styles.link} onPress={() => setEditing(null)}>
              <Text style={styles.linkText}>{t('settings.cancel')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    );
  }

  const remainingText = (value: number | null, unit: string) =>
    value === null ? '—' : value < 0 ? `${round1(-value)} ${unit} ${t('food.over')}` : `${round1(value)} ${unit}`;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('food.title')}</Text>
      <Text style={styles.meta}>{date}</Text>

      <View style={styles.card}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCol}>
            <Text style={styles.label}>{t('food.eaten')}</Text>
            <Text style={styles.big}>{`${round1(summary.consumed.calories)} ${t('today.kcal')}`}</Text>
            <Text style={styles.meta}>{`${t('food.protein')} ${round1(summary.consumed.proteinG)} g`}</Text>
            <Text style={styles.meta}>{`${t('food.carbs')} ${round1(summary.consumed.carbsG)} g`}</Text>
            <Text style={styles.meta}>{`${t('food.fat')} ${round1(summary.consumed.fatG)} g`}</Text>
          </View>
          <View style={styles.summaryCol}>
            <Text style={styles.label}>{t('food.remaining')}</Text>
            <Text style={[styles.big, summary.overCalories && styles.overText]}>{remainingText(summary.remaining.calories, t('today.kcal'))}</Text>
            <Text style={[styles.meta, summary.overProtein && styles.overText]}>{`${t('food.protein')} ${remainingText(summary.remaining.proteinG, 'g')}`}</Text>
          </View>
        </View>
        {targets.calories === null ? <Text style={styles.disclaimer}>{t('today.noCalories')}</Text> : null}
        {summary.incomplete ? <Text style={styles.warning}>{t('food.incomplete')}</Text> : null}
      </View>

      {MEAL_TYPES.map((meal) => {
        const group = day.byMeal[meal];
        return (
          <View key={meal} style={styles.card}>
            <View style={styles.mealHeader}>
              <Text style={styles.cardTitle}>{t(`food.meals.${meal}`)}</Text>
              <Text style={styles.meta}>{`${round1(group.totals.calories)} ${t('today.kcal')}`}</Text>
            </View>

            {group.entries.map((entry) => {
              const label = entry.food ? foodSourceLabel(entry.food) : null;
              return (
                <TouchableOpacity key={entry.id} accessibilityRole="button" style={styles.entry} onPress={() => setEditing(entry)}>
                  <Text style={styles.entryName}>{entry.food?.name ?? t('food.unavailable')}</Text>
                  <Text style={styles.meta}>
                    {[
                      entry.food ? formatServing(entry.quantity, entry.food.servingDesc) : null,
                      entry.nutrition ? `${round1(entry.nutrition.calories)} ${t('today.kcal')}` : null,
                      label ? `${t(label.key)}${label.verified ? ` · ${t('food.verified')}` : ''}` : null,
                      entry.pending ? t('workout.pending') : null,
                    ]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </Text>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              accessibilityRole="button"
              style={styles.addButton}
              onPress={() => router.push(`/food-search?meal=${meal}` as Href)}
            >
              <Text style={styles.addText}>{`+ ${t('food.addFood')}`}</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </ScrollView>
  );
}

const MUTED = '#8892A0';
const DANGER = '#FF6B6B';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[5], paddingTop: tokens.space[7], paddingBottom: tokens.space[7] },
  center: { flex: 1, backgroundColor: tokens.color.bg, alignItems: 'center', justifyContent: 'center' },
  title: { color: tokens.color.text, fontSize: 28, fontWeight: '700' },
  card: { backgroundColor: tokens.color.surface, borderRadius: 8, padding: tokens.space[4], marginTop: tokens.space[3] },
  cardTitle: { color: tokens.color.text, fontSize: 18, fontWeight: '600' },
  summaryRow: { flexDirection: 'row', gap: tokens.space[4] },
  summaryCol: { flex: 1 },
  label: { color: MUTED, fontSize: 13 },
  big: { color: tokens.color.text, fontSize: 22, fontWeight: '700', marginVertical: tokens.space[1] },
  overText: { color: DANGER },
  meta: { color: MUTED, fontSize: 13, lineHeight: 18 },
  disclaimer: { color: MUTED, fontSize: 12, marginTop: tokens.space[3], lineHeight: 17 },
  warning: { color: DANGER, fontSize: 12, marginTop: tokens.space[2] },
  mealHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  entry: { minHeight: tokens.minTap, justifyContent: 'center', paddingVertical: tokens.space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2D3748' },
  entryName: { color: tokens.color.text, fontSize: 16 },
  addButton: { minHeight: tokens.minTap, justifyContent: 'center' },
  addText: { color: tokens.color.accent, fontSize: 16, fontWeight: '600' },
  deleteButton: { minHeight: tokens.minTap, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[3], borderWidth: 1, borderColor: DANGER },
  deleteText: { color: DANGER, fontWeight: '600' },
  link: { minHeight: tokens.minTap, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: tokens.color.accent, fontSize: 16 },
});
