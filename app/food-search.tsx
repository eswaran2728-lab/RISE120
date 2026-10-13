import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { localDateString } from '../src/lib/dates';
import { useDebouncedValue } from '../src/lib/useDebouncedValue';
import { flushPending } from '../src/sync/flush';
import { supabaseTransport } from '../src/sync/supabaseTransport';
import { recentFoods } from '../src/food/cache';
import { newLogId, queueFoodLog } from '../src/food/log';
import { findFoods } from '../src/food/search';
import { defaultMealFor, foodSourceLabel } from '../src/food/summary';
import { Food, MEAL_TYPES, MealType } from '../src/food/types';
import { saveUsdaFood, searchUsda, UsdaPreview, UsdaSearchError } from '../src/food/usda';
import { FoodEntry } from '../src/ui/FoodEntry';

const round1 = (n: number) => Math.round(n * 10) / 10;
const MIN_QUERY = 2;

const usdaErrorKey = (error: unknown) =>
  error instanceof UsdaSearchError && error.code === 'rate_limited'
    ? 'food.search.usdaRateLimited'
    : error instanceof UsdaSearchError && error.code === 'not_configured'
      ? 'food.search.usdaNotConfigured'
      : 'food.search.usdaUnavailable';

export default function FoodSearchScreen() {
  useLanguage();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const params = useLocalSearchParams<{ meal?: string }>();
  const initialMeal: MealType = MEAL_TYPES.includes(params.meal as MealType) ? (params.meal as MealType) : defaultMealFor(new Date());

  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim(), 300);
  const [recent, setRecent] = useState<Food[]>([]);
  // Results are tagged with the query they belong to, so "searching" is simply "no results for the
  // current query yet".
  const [resultSet, setResultSet] = useState<{ query: string; foods: Food[]; hasMore: boolean; offline: boolean; page: number } | null>(null);

  const [worldwide, setWorldwide] = useState<UsdaPreview[] | null>(null);
  const [worldwideError, setWorldwideError] = useState<string | null>(null);
  const [worldwideBusy, setWorldwideBusy] = useState(false);

  const [selected, setSelected] = useState<{ food: Food; entryId: string } | null>(null);
  const [savingFood, setSavingFood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void recentFoods(userId).then((foods) => alive && setRecent(foods));
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || debounced.length < MIN_QUERY) return;
    let alive = true;
    findFoods(userId, debounced, 0).then((result) => {
      if (!alive) return;
      setResultSet({ query: debounced, foods: result.foods, hasMore: result.hasMore, offline: result.offline, page: 0 });
      setWorldwide(null);
      setWorldwideError(null);
    });
    return () => {
      alive = false;
    };
  }, [userId, debounced]);

  const searchingNow = debounced.length >= MIN_QUERY;
  const current = resultSet && resultSet.query === debounced ? resultSet : null;
  const searching = searchingNow && current === null;
  const shown = searchingNow ? (current?.foods ?? []) : recent;
  const offline = current?.offline ?? false;
  const hasMore = current?.hasMore ?? false;

  const loadMore = async () => {
    if (!userId || !current) return;
    const result = await findFoods(userId, debounced, current.page + 1);
    setResultSet({
      query: debounced,
      foods: [...current.foods, ...result.foods.filter((food) => !current.foods.some((existing) => existing.id === food.id))],
      hasMore: result.hasMore,
      offline: result.offline,
      page: current.page + 1,
    });
  };

  const searchWorldwide = async () => {
    setWorldwideBusy(true);
    setWorldwideError(null);
    try {
      const result = await searchUsda(debounced, 0);
      setWorldwide(result.foods);
    } catch (searchError) {
      setWorldwide(null);
      setWorldwideError(t(usdaErrorKey(searchError)));
    } finally {
      setWorldwideBusy(false);
    }
  };

  // A chosen USDA result becomes the user's own unverified food first, so it can be logged and used offline.
  const chooseWorldwide = async (preview: UsdaPreview) => {
    if (!userId || savingFood) return;
    setSavingFood(true);
    setWorldwideError(null);
    try {
      setSelected({ food: await saveUsdaFood(userId, preview), entryId: newLogId() });
    } catch {
      setWorldwideError(t('errors.generic'));
    } finally {
      setSavingFood(false);
    }
  };

  const submit = async (quantity: number, meal: MealType) => {
    if (!userId || !selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      // The meal goes on the day the user is actually logging it, even if this screen was left open
      // overnight, so it appears on today's Food tab.
      await queueFoodLog(userId, localDateString(), { id: selected.entryId, food: selected.food, quantity, mealType: meal });
      void flushPending(userId, supabaseTransport).catch(() => undefined);
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/food' as Href);
    } catch {
      setError(t('food.entry.saveError'));
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FoodEntry
          food={selected.food}
          initialMeal={initialMeal}
          submitLabelKey="food.entry.add"
          busy={busy}
          error={error}
          onSubmit={submit}
          onCancel={() => setSelected(null)}
        />
      </ScrollView>
    );
  }

  const row = (food: Food) => {
    const label = foodSourceLabel(food);
    return (
      <View key={food.id} style={styles.rowWrap}>
        <TouchableOpacity accessibilityRole="button" style={styles.rowMain} onPress={() => setSelected({ food, entryId: newLogId() })}>
          <Text style={styles.name}>{food.name}</Text>
          <Text style={styles.meta}>{`${food.servingDesc}  ·  ${round1(food.calories)} ${t('today.kcal')}`}</Text>
          <Text style={label.verified ? styles.verified : styles.meta}>{`${t(label.key)}${label.verified ? ` · ${t('food.verified')}` : ''}`}</Text>
        </TouchableOpacity>
        {food.source === 'custom' && food.userId !== null ? (
          <TouchableOpacity accessibilityRole="button" style={styles.editButton} onPress={() => router.push(`/food-edit?id=${food.id}` as Href)}>
            <Text style={styles.linkText}>{t('food.custom.edit')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={t('food.search.placeholder')}
          placeholderTextColor={MUTED}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />

        {offline && searchingNow ? <Text style={styles.warning}>{t('food.search.offline')}</Text> : null}
        {!searchingNow && recent.length > 0 ? <Text style={styles.heading}>{t('food.search.recent')}</Text> : null}
        {searching ? <ActivityIndicator color={tokens.color.accent} style={styles.spinner} /> : null}

        {shown.map(row)}
        {searchingNow && !searching && shown.length === 0 ? <Text style={styles.meta}>{t('food.search.noResults')}</Text> : null}
        {searchingNow && hasMore ? (
          <TouchableOpacity accessibilityRole="button" style={styles.link} onPress={() => void loadMore()}>
            <Text style={styles.linkText}>{t('food.search.more')}</Text>
          </TouchableOpacity>
        ) : null}

        {searchingNow && !offline ? (
          <View style={styles.section}>
            {worldwide === null ? (
              <TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={() => void searchWorldwide()} disabled={worldwideBusy}>
                {worldwideBusy ? <ActivityIndicator color={tokens.color.accent} /> : <Text style={styles.secondaryText}>{t('food.search.worldwide')}</Text>}
              </TouchableOpacity>
            ) : (
              <>
                <Text style={styles.heading}>{t('food.search.worldwide')}</Text>
                <Text style={styles.meta}>{t('food.search.worldwideNote')}</Text>
                {worldwide.length === 0 ? <Text style={styles.meta}>{t('food.search.noResults')}</Text> : null}
                {worldwide.map((preview) => (
                  <TouchableOpacity key={preview.sourceId} accessibilityRole="button" style={styles.row} onPress={() => void chooseWorldwide(preview)}>
                    <Text style={styles.name}>{preview.name}</Text>
                    <Text style={styles.meta}>{`${preview.servingDesc}  ·  ${round1(preview.calories)} ${t('today.kcal')}${preview.brand ? `  ·  ${preview.brand}` : ''}`}</Text>
                    <Text style={styles.meta}>{t('food.sources.usda')}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}
            {savingFood ? <Text style={styles.meta}>{t('food.search.saving')}</Text> : null}
            {worldwideError ? <Text style={styles.errorText}>{worldwideError}</Text> : null}
          </View>
        ) : null}

        <TouchableOpacity accessibilityRole="button" style={styles.link} onPress={() => router.push('/food-scan' as Href)}>
          <Text style={styles.linkText}>{t('food.search.scan')}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.link} onPress={() => router.push('/food-edit' as Href)}>
          <Text style={styles.linkText}>{t('food.search.addOwn')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const MUTED = '#8892A0';
const DANGER = '#FF6B6B';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[5], paddingTop: tokens.space[7], paddingBottom: tokens.space[7] },
  input: { backgroundColor: tokens.color.surface, color: tokens.color.text, borderRadius: 8, paddingHorizontal: tokens.space[4], minHeight: tokens.minTap, fontSize: 16 },
  heading: { color: tokens.color.text, fontSize: 18, fontWeight: '600', marginTop: tokens.space[4], marginBottom: tokens.space[1] },
  section: { marginTop: tokens.space[3] },
  row: { minHeight: tokens.minTap, justifyContent: 'center', paddingVertical: tokens.space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2D3748' },
  rowWrap: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2D3748' },
  rowMain: { flex: 1, minHeight: tokens.minTap, justifyContent: 'center', paddingVertical: tokens.space[2] },
  editButton: { minHeight: tokens.minTap, minWidth: tokens.minTap, alignItems: 'center', justifyContent: 'center', paddingHorizontal: tokens.space[2] },
  name: { color: tokens.color.text, fontSize: 16 },
  meta: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: 2 },
  verified: { color: tokens.color.accent, fontSize: 13, marginTop: 2 },
  warning: { color: MUTED, fontSize: 13, marginTop: tokens.space[3] },
  errorText: { color: DANGER, marginTop: tokens.space[2] },
  spinner: { marginVertical: tokens.space[3] },
  secondaryButton: { minHeight: tokens.minTap, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2D3748' },
  secondaryText: { color: tokens.color.text, fontSize: 16 },
  link: { minHeight: tokens.minTap, justifyContent: 'center' },
  linkText: { color: tokens.color.accent, fontSize: 16 },
});
