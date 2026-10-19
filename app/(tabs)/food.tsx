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
import { LimitNotice } from '../../src/ui/LimitNotice';
import { useUnlock } from '../../src/monetization/useUnlock';
import { formatReset, LimitSnapshot, loadLimitsOrCached, unlockActions } from '../../src/monetization/limits';
import { withAccountKey } from '../../src/auth/withAccountKey';

const round1 = (n: number) => Math.round(n * 10) / 10;

function FoodScreen() {
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
  const [limits, setLimits] = useState<{ snapshot: LimitSnapshot; stale: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const [foodDay, bundle, limitResult] = await Promise.all([
      loadFoodDay(userId, date),
      loadPlanBundle(userId).catch(() => null),
      loadLimitsOrCached(userId),
    ]);
    if (!mounted.current) return;
    setLimits(limitResult);
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

  const unlock = useUnlock({
    rewardType: 'food',
    onChanged: () => {
      // A reward arrived (or is on its way): reload, and let waiting logs retry now rather than at the next timer.
      void load().catch(() => undefined);
      syncThenReload();
    },
  });
  const unlockMessage = unlock.messageKey ? t(unlock.messageKey) : null;

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

  // The server's reset time (00:00 UTC) shown in local time and in UTC.
  const resetDetail = (resetsAt: string | null | undefined) => {
    if (!resetsAt) return null;
    const { local, utc } = formatReset(resetsAt);
    return `${t('limits.resetsAt')} ${local} (${utc} UTC)`;
  };
  const snapshot = limits?.snapshot ?? null;
  const blockedEntries = day.entries.filter((entry) => entry.blocked);
  const allowance = snapshot?.food ?? null;
  const allowanceText = !allowance
    ? null
    : allowance.base === null
      ? `${t('limits.foodToday')}: ${t('limits.unlimited')}`
      : `${t('limits.foodToday')}: ${allowance.used} / ${allowance.base + allowance.bonus}${allowance.bonus > 0 ? `  (+${allowance.bonus} ${t('limits.fromAds')})` : ''}`;

  const remainingText = (value: number | null, unit: string) =>
    value === null ? '—' : value < 0 ? `${round1(-value)} ${unit} ${t('food.over')}` : `${round1(value)} ${unit}`;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('food.title')}</Text>
      <Text style={styles.meta}>{date}</Text>
      <TouchableOpacity testID="food-open-planner" accessibilityRole="button" style={styles.addButton} onPress={() => router.push('/meal-planner' as Href)}>
        <Text style={styles.addText}>{t('planner.open')}</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="food-open-eating-out" accessibilityRole="button" style={styles.addButton} onPress={() => router.push('/eating-out' as Href)}>
        <Text style={styles.addText}>{t('eatingOut.open')}</Text>
      </TouchableOpacity>

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

      {allowanceText ? (
        <View style={styles.card}>
          <Text style={styles.entryName}>{allowanceText}</Text>
          {limits?.stale ? <Text style={styles.meta}>{t('limits.lastKnown')}</Text> : null}
        </View>
      ) : null}

      {snapshot && snapshot.tier === 'free' && snapshot.food.remaining === 0 ? (
        <LimitNotice
          body={t('limits.reached')}
          detail={resetDetail(snapshot.resetsAt)}
          actions={unlockActions(snapshot, 'food')}
          onAction={unlock.run}
          busy={unlock.busy}
          message={unlockMessage}
        />
      ) : null}

      {blockedEntries.length > 0 ? (
        <LimitNotice
          title={t('limits.pendingEntry')}
          body={t('limits.pendingBody')}
          detail={resetDetail(blockedEntries[0].blocked?.resetsAt ?? snapshot?.resetsAt)}
          actions={unlockActions(snapshot, 'food')}
          onAction={unlock.run}
          busy={unlock.busy}
          message={unlockMessage}
        />
      ) : null}

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
                      entry.blocked ? t('limits.pendingEntry') : entry.pending ? t('workout.pending') : null,
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

const MUTED = tokens.color.textSecondary;
const DANGER = tokens.color.danger;

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
  entry: { minHeight: tokens.minTap, justifyContent: 'center', paddingVertical: tokens.space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border },
  entryName: { color: tokens.color.text, fontSize: 16 },
  addButton: { minHeight: tokens.minTap, justifyContent: 'center' },
  addText: { color: tokens.color.accent, fontSize: 16, fontWeight: '600' },
  deleteButton: { minHeight: tokens.minTap, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[3], borderWidth: 1, borderColor: DANGER },
  deleteText: { color: DANGER, fontWeight: '600' },
  link: { minHeight: tokens.minTap, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: tokens.color.accent, fontSize: 16 },
});

export default withAccountKey(FoodScreen);
