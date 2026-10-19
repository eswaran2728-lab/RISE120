import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Href, useFocusEffect, useRouter } from 'expo-router';
import { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { withAccountKey } from '../src/auth/withAccountKey';
import { newLogId } from '../src/food/log';
import { loadRecipes } from '../src/food/recipeData';
import type { Cooking, DietLabel, Recipe } from '../src/food/recipes';
import { loadSavedPlan, saveMealPlan, SavedPlan, Selection } from '../src/food/mealPlanner/api';
import { logPlannedMeal } from '../src/food/mealPlanner/plannedLog';
import { DEFAULT_PREFS, loadMealPrefs, mealTypeForSlot, saveMealPrefs } from '../src/food/mealPlanner/prefs';
import { MealPlan, Preferences, selectMeals } from '../src/food/mealPlanner/select';
import { mergeShoppingList } from '../src/food/mealPlanner/shoppingList';
import { useLocalDate } from '../src/lib/useLocalDate';
import { capabilitiesOf, LimitSnapshot, loadLimitsOrCached } from '../src/monetization/limits';
import { parseDecimal } from '../src/onboarding/units';
import { loadPlanBundle } from '../src/plan/planData';
import { getPlanDay } from '../src/today/selectors';
import { pick } from '../src/workout/localise';
import { ActionButton } from '../src/ui/ActionButton';
import { AsyncState } from '../src/ui/AsyncState';
import { ScreenFrame } from '../src/ui/ScreenFrame';
import { SectionCard } from '../src/ui/SectionCard';

const COOKERS: Cooking[] = ['stovetop', 'rice_cooker', 'oven', 'microwave', 'kettle'];
const DIETS: DietLabel[] = ['vegetarian', 'vegan'];
const TIMES = [15, 30, 45];
const DAYS = [1, 3, 7];
const CURRENCY = 'MYR'; // recipes are priced in the currency of their region (Malaysia)
const round1 = (n: number) => Math.round(n * 10) / 10;

interface Loaded {
  recipes: Recipe[];
  prefs: Preferences;
  saved: SavedPlan;
  snapshot: LimitSnapshot | null;
  targets: { calories: number | null; proteinG: number | null };
}

// Meal planning from reviewed recipes. The plan is a candidate until the member saves it (a premium feature the server
// enforces); choosing a recipe never logs food, and logging a planned meal asks for confirmation first. With no
// suitable reviewed recipe there is a plain explanation and the way to log food by hand.
function MealPlannerScreen() {
  const language = useLanguage();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const date = useLocalDate();
  const [loaded, setLoaded] = useState<Loaded | 'loading'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const alive = useRef(true);
  // The same save keeps the same request id until it gets a definite answer, so a lost reply cannot save twice.
  const request = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    const [recipes, prefs, saved, limits, bundle] = await Promise.all([
      loadRecipes(userId),
      loadMealPrefs(userId),
      loadSavedPlan().catch(() => ({ kind: 'unreadable' }) as SavedPlan),
      loadLimitsOrCached(userId).catch(() => null),
      loadPlanBundle(userId).catch(() => null),
    ]);
    if (!alive.current) return;
    const day = bundle ? getPlanDay(bundle.plan, bundle.days, date) : null;
    setLoaded({ recipes, prefs, saved, snapshot: limits?.snapshot ?? null, targets: { calories: day?.calorieTarget ?? null, proteinG: day?.proteinTargetG ?? null } });
  }, [userId, date]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const prefs = loaded === 'loading' ? DEFAULT_PREFS : loaded.prefs;
  const recipes = useMemo(() => (loaded === 'loading' ? [] : loaded.recipes), [loaded]);
  const plan: MealPlan | null = useMemo(() => {
    if (loaded === 'loading' || recipes.length === 0) return null;
    return selectMeals(loaded.prefs, recipes, loaded.targets);
  }, [loaded, recipes]);

  if (!userId) return <AsyncState state={{ kind: 'error', message: t('planner.loadError') }} />;
  if (loaded === 'loading') return <AsyncState state={{ kind: 'loading' }} />;

  const byKey = new Map(recipes.map((r) => [`${r.id}@${r.version}`, r]));
  const recipeOf = (id: string, version: number) => byKey.get(`${id}@${version}`)!;

  const update = async (next: Preferences) => {
    if (await saveMealPrefs(userId, next)) setLoaded((current) => (current === 'loading' ? current : { ...current, prefs: next }));
  };
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const capabilities = capabilitiesOf(loaded.snapshot);
  const canSave = loaded.snapshot === null ? true : capabilities.mealPlanner; // with no snapshot the server decides
  const showUpgrade = loaded.snapshot !== null && !capabilities.mealPlanner;

  const selections: Selection[] = plan ? plan.days.flatMap((d) => d.meals.map((m) => ({ recipeId: m.recipeId, version: m.version, servings: m.servings, day: d.day, slot: m.slot }))) : [];
  const expectedRevision = loaded.saved.kind === 'plan' ? loaded.saved.revision : 0;

  const save = async () => {
    const key = `${expectedRevision}|${JSON.stringify(selections)}`;
    if (request.current?.key !== key) request.current = { key, id: newLogId() };
    const result = await saveMealPlan({ requestId: request.current.id, expectedRevision, selections });
    if (!alive.current) return;
    if (result.kind === 'offline' || result.kind === 'error') {
      setMessage(t(result.kind === 'offline' ? 'planner.saveOffline' : 'planner.saveError'));
      return;
    }
    request.current = null;
    if (result.kind === 'saved') {
      setLoaded((current) => (current === 'loading' ? current : { ...current, saved: { kind: 'plan', revision: result.revision, selections } }));
      setMessage(t('planner.saved', { revision: result.revision }));
    } else if (result.kind === 'stale') {
      setMessage(t('planner.stale'));
      const fresh = await loadSavedPlan().catch(() => ({ kind: 'unreadable' }) as SavedPlan);
      if (alive.current) setLoaded((current) => (current === 'loading' ? current : { ...current, saved: fresh }));
    } else if (result.kind === 'premium_required') {
      setMessage(t('planner.premiumNeeded'));
    } else if (result.kind === 'recipe_unavailable') {
      setMessage(t('planner.recipeGone'));
    } else {
      setMessage(t('planner.saveError'));
    }
  };

  const log = async (day: number, slot: number, recipe: Recipe, servings: number) => {
    const result = await logPlannedMeal(userId, date, { recipe, servings, mealType: mealTypeForSlot(slot, prefs.mealsPerDay), slotKey: `${day}:${slot}`, confirmed: true });
    if (!alive.current) return;
    if (result.kind === 'logged') {
      setMessage(t('planner.logged'));
      setConfirming(null);
    } else if (result.kind === 'offline') {
      setMessage(t('planner.logOffline'));
    } else if (result.kind === 'nutrition_unknown') {
      setMessage(t('planner.logNutritionUnknown'));
    }
  };

  const shopping = plan ? mergeShoppingList(plan.days.flatMap((d) => d.meals.map((m) => ({ recipe: recipeOf(m.recipeId, m.version), servings: m.servings })))) : [];
  const unitLabel = (unit: string) => t(`planner.unit.${unit}`);

  return (
    <ScreenFrame>
      <ActionButton variant="link" label={t('onboarding.back')} onPress={() => router.back()} />
      <Text accessibilityRole="header" style={styles.title}>{t('planner.title')}</Text>
      <Text style={styles.note}>{t('planner.intro')}</Text>

      <SectionCard title={t('planner.yourChoices')}>
        <Text style={styles.note}>{t('planner.cooking')}</Text>
        <View style={styles.row}>
          {COOKERS.map((c) => (
            <View key={c} style={styles.chip}>
              <ActionButton testID={`planner-cooking-${c}`} variant={prefs.cooking.includes(c) ? 'primary' : 'secondary'} label={t(`planner.cooker.${c}`)} onPress={() => update({ ...prefs, cooking: toggle(prefs.cooking, c) })} />
            </View>
          ))}
        </View>
        <Text style={styles.note}>{t('planner.time')}</Text>
        <View style={styles.row}>
          <View style={styles.chip}>
            <ActionButton testID="planner-time-any" variant={prefs.maxMinutes === null ? 'primary' : 'secondary'} label={t('planner.anyTime')} onPress={() => update({ ...prefs, maxMinutes: null })} />
          </View>
          {TIMES.map((m) => (
            <View key={m} style={styles.chip}>
              <ActionButton testID={`planner-time-${m}`} variant={prefs.maxMinutes === m ? 'primary' : 'secondary'} label={t('planner.minutes', { count: m })} onPress={() => update({ ...prefs, maxMinutes: m })} />
            </View>
          ))}
        </View>
        <Text style={styles.note}>{t('planner.diet')}</Text>
        <View style={styles.row}>
          {DIETS.map((d) => (
            <View key={d} style={styles.chip}>
              <ActionButton testID={`planner-diet-${d}`} variant={prefs.diets.includes(d) ? 'primary' : 'secondary'} label={t(`planner.dietLabel.${d}`)} onPress={() => update({ ...prefs, diets: toggle(prefs.diets, d) })} />
            </View>
          ))}
        </View>
        <Text style={styles.note}>{t('planner.days')}</Text>
        <View style={styles.row}>
          {DAYS.map((n) => (
            <View key={n} style={styles.chip}>
              <ActionButton testID={`planner-days-${n}`} variant={prefs.days === n ? 'primary' : 'secondary'} label={t('planner.dayCount', { count: n })} onPress={() => update({ ...prefs, days: n })} />
            </View>
          ))}
        </View>
        <Text style={styles.note}>{t('planner.budget')}</Text>
        <TextInput
          testID="planner-budget"
          accessibilityLabel={t('planner.budget')}
          placeholder={t('planner.budgetHint')}
          placeholderTextColor={tokens.color.textSecondary}
          keyboardType="decimal-pad"
          defaultValue={prefs.budget ? String(prefs.budget.amount) : ''}
          onChangeText={(text) => {
            const amount = text.trim() === '' ? null : parseDecimal(text);
            void update({ ...prefs, budget: amount === null || amount < 0 ? null : { amount, currency: CURRENCY, per: 'day' } });
          }}
          style={styles.input}
        />
      </SectionCard>

      {recipes.length === 0 ? (
        <SectionCard title={t('planner.planTitle')}>
          <Text testID="planner-empty" style={styles.body}>{t('planner.empty')}</Text>
          <ActionButton testID="planner-manual" variant="secondary" label={t('planner.logByHand')} onPress={() => router.push('/(tabs)/food' as Href)} />
        </SectionCard>
      ) : plan && plan.days.length === 0 ? (
        <SectionCard title={t('planner.planTitle')}>
          <Text style={styles.body}>{t('planner.noMatch')}</Text>
          <ActionButton testID="planner-manual" variant="secondary" label={t('planner.logByHand')} onPress={() => router.push('/(tabs)/food' as Href)} />
        </SectionCard>
      ) : plan ? (
        <>
          <SectionCard title={t('planner.planTitle')}>
            <Text style={styles.note}>{t('planner.candidate')}</Text>
            {plan.days.map((d) => (
              <View key={d.day} style={styles.day}>
                <Text accessibilityRole="header" style={styles.dayTitle}>{t('planner.dayN', { count: d.day + 1 })}</Text>
                {d.meals.map((m) => {
                  const recipe = recipeOf(m.recipeId, m.version);
                  const key = `${d.day}-${m.slot}`;
                  return (
                    <View key={key} testID={`planner-meal-${key}`} style={styles.meal}>
                      <Text style={styles.body}>{`${t(`food.meals.${mealTypeForSlot(m.slot, prefs.mealsPerDay)}`)}: ${pick(recipe.name, language)}`}</Text>
                      <Text style={styles.note}>{t('planner.servings', { count: m.servings })}</Text>
                      <Text style={styles.note}>{m.nutrition?.calories == null ? t('planner.kcalUnknown') : `${round1(m.nutrition.calories)} ${t('today.kcal')}`}</Text>
                      <Text style={styles.note}>{m.price ? t('planner.price', { amount: m.price.amount, currency: m.price.currency }) : t('planner.priceUnknown')}</Text>
                      {d.day === 0 ? (
                        confirming === key ? (
                          <>
                            <Text style={styles.body}>{t('planner.logAsk', { name: pick(recipe.name, language), meal: t(`food.meals.${mealTypeForSlot(m.slot, prefs.mealsPerDay)}`) })}</Text>
                            <ActionButton testID={`planner-log-confirm-${key}`} label={t('planner.logConfirm')} onPress={() => log(d.day, m.slot, recipe, m.servings)} />
                            <ActionButton variant="link" label={t('planner.cancel')} onPress={() => setConfirming(null)} />
                          </>
                        ) : (
                          <ActionButton testID={`planner-log-${key}`} variant="secondary" label={t('planner.log')} onPress={() => setConfirming(key)} />
                        )
                      ) : null}
                    </View>
                  );
                })}
                <Text style={styles.note}>{d.calories === null ? t('planner.dayTotalUnknown') : t('planner.dayTotal', { count: round1(d.calories) })}</Text>
              </View>
            ))}
            {plan.limitations.map((l) => (
              <Text key={l.code} accessibilityLiveRegion="polite" style={styles.warning}>{t(`planner.limit.${l.code}`)}</Text>
            ))}
            {plan.budget.status === 'within' ? <Text style={styles.note}>{t('planner.budgetWithin', { total: String(plan.budget.total), limit: String(plan.budget.limit), currency: String(plan.budget.currency) })}</Text> : null}
            {plan.budget.status === 'over' ? <Text style={styles.warning}>{t('planner.budgetOver', { total: String(plan.budget.total), limit: String(plan.budget.limit), currency: String(plan.budget.currency) })}</Text> : null}
          </SectionCard>

          <SectionCard title={t('planner.shopping')}>
            {shopping.map((item) => (
              <Text key={`${item.ref.source}|${item.ref.sourceId}|${item.unit}`} style={styles.body}>{`${item.name}: ${item.amount} ${unitLabel(item.unit)}`}</Text>
            ))}
          </SectionCard>

          {showUpgrade ? (
            <SectionCard>
              <Text style={styles.body}>{t('planner.premiumOnly')}</Text>
              <ActionButton testID="planner-upgrade" variant="secondary" label={t('planner.upgrade')} onPress={() => router.push('/paywall' as Href)} />
            </SectionCard>
          ) : null}
          {canSave ? <ActionButton testID="planner-save" label={t('planner.save')} onPress={save} /> : null}
        </>
      ) : null}

      {message ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{message}</Text> : null}
    </ScreenFrame>
  );
}

export default withAccountKey(MealPlannerScreen);

const styles = StyleSheet.create({
  title: { color: tokens.color.text, fontSize: 28, lineHeight: 36, fontWeight: '700', marginBottom: tokens.space[2] },
  body: { color: tokens.color.text, fontSize: 16, lineHeight: 24, marginVertical: tokens.space[1] },
  note: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginVertical: tokens.space[1] },
  warning: { color: tokens.color.warning, fontSize: 16, lineHeight: 24, marginVertical: tokens.space[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { marginRight: tokens.space[2], marginBottom: tokens.space[2] },
  day: { marginTop: tokens.space[3] },
  dayTitle: { color: tokens.color.accent, fontSize: 18, lineHeight: 27, fontWeight: '600' },
  meal: { marginTop: tokens.space[2], paddingTop: tokens.space[2], borderTopWidth: 1, borderTopColor: tokens.color.border },
  input: { minHeight: tokens.minTap, borderRadius: tokens.radius.control, borderWidth: 1, borderColor: tokens.color.borderStrong, backgroundColor: tokens.color.surfaceRaised, color: tokens.color.text, fontSize: 16, paddingHorizontal: tokens.space[3] },
});
