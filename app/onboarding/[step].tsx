import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Href, useLocalSearchParams, useRouter } from 'expo-router';
import i18next, { t } from '../../src/i18n';
import { tokens } from '../../src/theme/tokens';
import { useSession } from '../../src/auth/useSession';
import { signOut } from '../../src/auth/authService';
import { clearDraft, loadDraft, OnboardingDraft, saveDraft } from '../../src/onboarding/draft';
import { notifyOnboardingComplete } from '../../src/onboarding/completion';
import { submitProfile } from '../../src/onboarding/submit';
import { cmFromFtIn, ftInFromCm, kgFromLb, lbFromKg, parseDecimal } from '../../src/onboarding/units';
import { BodyField, validateBody } from '../../src/onboarding/validation';

const TOTAL_STEPS = 5;
const GOALS = ['lose_fat', 'build_muscle', 'recomp'] as const;
const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
const EQUIPMENT = ['gym', 'home', 'none'] as const;
const FOODS = ['halal', 'vegetarian', 'vegan', 'dairy_free', 'nut_free'] as const;
const LANGUAGES = ['en', 'ms', 'ta'] as const;
const UNITS = ['metric', 'imperial'] as const;

type Draft = Partial<OnboardingDraft>;
type FieldErrors = Partial<Record<BodyField, string>>;

const round1 = (n: number) => Math.round(n * 10) / 10;
const toText = (n: number | undefined) => (n === undefined ? '' : String(round1(n)));
const stepHref = (step: number) => `/onboarding/${step}` as Href;

function currentLanguage(): OnboardingDraft['language'] {
  return LANGUAGES.find((language) => language === i18next.language) ?? 'en';
}

function isNetworkError(error: unknown): boolean {
  return error instanceof Error && /network|fetch|offline/i.test(error.message);
}

export default function OnboardingStep() {
  const { step: stepParam } = useLocalSearchParams<{ step: string }>();
  const router = useRouter();
  const { session } = useSession();
  const parsedStep = Number(stepParam);
  const step = Number.isInteger(parsedStep) && parsedStep >= 1 && parsedStep <= TOTAL_STEPS ? parsedStep : 1;

  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [units, setUnits] = useState<OnboardingDraft['units']>('metric');
  const [ageText, setAgeText] = useState('');
  const [heightText, setHeightText] = useState('');
  const [feetText, setFeetText] = useState('');
  const [inchesText, setInchesText] = useState('');
  const [weightText, setWeightText] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitLock = useRef(false);

  const fillBodyTexts = (body: Draft, bodyUnits: OnboardingDraft['units']) => {
    setAgeText(body.age === undefined ? '' : String(body.age));
    if (bodyUnits === 'imperial') {
      const feetInches = body.heightCm === undefined ? undefined : ftInFromCm(body.heightCm);
      setFeetText(feetInches ? String(feetInches.ft) : '');
      setInchesText(feetInches ? String(feetInches.inches) : '');
      setHeightText('');
      setWeightText(body.weightKg === undefined ? '' : toText(lbFromKg(body.weightKg)));
    } else {
      setHeightText(toText(body.heightCm));
      setFeetText('');
      setInchesText('');
      setWeightText(toText(body.weightKg));
    }
  };

  useEffect(() => {
    let alive = true;
    loadDraft().then(({ draft: saved, step: savedStep }) => {
      if (!alive) return;
      const resumeStep = Math.min(TOTAL_STEPS, Math.max(1, savedStep));
      if (resumeStep !== step) {
        router.replace(stepHref(resumeStep));
        return;
      }
      const savedUnits = saved.units ?? 'metric';
      setDraft(saved);
      setUnits(savedUnits);
      fillBodyTexts(saved, savedUnits);
      setReady(true);
    });
    return () => {
      alive = false;
    };
    // fillBodyTexts only sets state; reload when the step changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const goToStep = async (next: Draft, target: number) => {
    setDraft(next);
    await saveDraft(next, target);
    router.replace(stepHref(target));
  };

  const parseBody = (): { body?: Required<Pick<Draft, 'age' | 'heightCm' | 'weightKg'>>; errors: FieldErrors } => {
    const errors: FieldErrors = {};
    const age = parseDecimal(ageText);
    if (age === null || !Number.isInteger(age)) errors.age = t('onboarding.errors.number');

    let heightCm: number | null = null;
    if (units === 'imperial') {
      const feet = parseDecimal(feetText);
      const inches = inchesText.trim() === '' ? 0 : parseDecimal(inchesText);
      if (feet !== null && inches !== null) heightCm = round1(cmFromFtIn(feet, inches));
    } else {
      heightCm = parseDecimal(heightText);
    }
    if (heightCm === null) errors.heightCm = t('onboarding.errors.number');

    const weight = parseDecimal(weightText);
    if (weight === null) errors.weightKg = t('onboarding.errors.number');
    const weightKg = weight === null ? null : units === 'imperial' ? round1(kgFromLb(weight)) : weight;

    if (age === null || heightCm === null || weightKg === null || Object.keys(errors).length > 0) {
      return { errors };
    }
    const result = validateBody({ age, heightCm, weightKg });
    if (!result.ok) {
      errors[result.field] = t(result.reason === 'min' ? 'onboarding.errors.tooLow' : 'onboarding.errors.tooHigh');
      return { errors };
    }
    return { body: { age, heightCm, weightKg }, errors };
  };

  const switchUnits = (next: OnboardingDraft['units']) => {
    if (next === units) return;
    // Carry over values that already parse so toggling does not lose input.
    const height = units === 'imperial'
      ? (() => {
          const feet = parseDecimal(feetText);
          const inches = inchesText.trim() === '' ? 0 : parseDecimal(inchesText);
          return feet !== null && inches !== null ? cmFromFtIn(feet, inches) : undefined;
        })()
      : parseDecimal(heightText) ?? undefined;
    const weight = parseDecimal(weightText);
    const weightKg = weight === null ? undefined : units === 'imperial' ? kgFromLb(weight) : weight;
    setUnits(next);
    setFieldErrors({});
    fillBodyTexts({ age: parseDecimal(ageText) ?? undefined, heightCm: height, weightKg }, next);
  };

  const finish = async (final: Draft) => {
    const userId = session?.user?.id;
    const { goal, age, heightCm, weightKg, trainingLevel, equipment, foodPreferences, language } = final;
    if (!userId || !goal || age === undefined || heightCm === undefined || weightKg === undefined ||
        !trainingLevel || !equipment || !foodPreferences || !language) {
      setSubmitError(t('errors.generic'));
      return;
    }
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitProfile(userId, { goal, age, heightCm, weightKg, trainingLevel, equipment, foodPreferences, language, units });
      await clearDraft();
      notifyOnboardingComplete();
      router.replace('/(tabs)/today' as Href);
    } catch (error) {
      await saveDraft(final, TOTAL_STEPS);
      setSubmitError(t(isNetworkError(error) ? 'errors.offline' : 'errors.generic'));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  const onNext = async () => {
    if (step === 2) {
      const { body, errors } = parseBody();
      setFieldErrors(errors);
      if (!body) return;
      await goToStep({ ...draft, ...body, units }, 3);
    } else if (step === TOTAL_STEPS) {
      const final = { ...draft, foodPreferences: draft.foodPreferences ?? [], language: draft.language ?? currentLanguage(), units };
      setDraft(final);
      await finish(final);
    } else {
      await goToStep(draft, step + 1);
    }
  };

  const onBack = async () => {
    await goToStep(draft, step - 1);
  };

  const canProceed =
    (step === 1 && !!draft.goal) ||
    step === 2 ||
    (step === 3 && !!draft.trainingLevel) ||
    (step === 4 && !!draft.equipment) ||
    step === TOTAL_STEPS;

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.color.accent} size="large" />
      </View>
    );
  }

  const titles = ['onboarding.goal', 'onboarding.stats', 'onboarding.level', 'onboarding.equipment', 'onboarding.food'];

  const toggleFood = (food: string) => {
    const current = draft.foodPreferences ?? [];
    setDraft({ ...draft, foodPreferences: current.includes(food) ? current.filter((f) => f !== food) : [...current, food] });
  };

  const chooseLanguage = (language: OnboardingDraft['language']) => {
    setDraft({ ...draft, language });
    void i18next.changeLanguage(language);
  };

  const field = (label: string, value: string, onChange: (v: string) => void, error?: string) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholderTextColor={MUTED}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );

  const options = <T extends string>(values: readonly T[], selected: T | undefined, labelKey: string, onPick: (v: T) => void) =>
    values.map((value) => (
      <TouchableOpacity
        key={value}
        accessibilityRole="button"
        style={[styles.option, selected === value && styles.optionSelected]}
        onPress={() => onPick(value)}
      >
        <Text style={[styles.optionText, selected === value && styles.optionTextSelected]}>{t(`${labelKey}.${value}`)}</Text>
      </TouchableOpacity>
    ));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.progress}>{`${step} / ${TOTAL_STEPS}`}</Text>
      <Text style={styles.title}>{t(titles[step - 1])}</Text>

      {step === 1 && options(GOALS, draft.goal, 'onboarding.goals', (goal) => setDraft({ ...draft, goal }))}

      {step === 2 && (
        <>
          <View style={styles.row}>{options(UNITS, units, 'onboarding.unitOptions', switchUnits)}</View>
          {field(t('onboarding.fields.age'), ageText, setAgeText, fieldErrors.age)}
          {units === 'metric'
            ? field(t('onboarding.fields.height'), heightText, setHeightText, fieldErrors.heightCm)
            : (
              <>
                {field(t('onboarding.fields.heightFt'), feetText, setFeetText, fieldErrors.heightCm)}
                {field(t('onboarding.fields.heightIn'), inchesText, setInchesText)}
              </>
            )}
          {field(t(units === 'metric' ? 'onboarding.fields.weight' : 'onboarding.fields.weightLb'), weightText, setWeightText, fieldErrors.weightKg)}
        </>
      )}

      {step === 3 && options(LEVELS, draft.trainingLevel, 'onboarding.levels', (trainingLevel) => setDraft({ ...draft, trainingLevel }))}

      {step === 4 && options(EQUIPMENT, draft.equipment, 'onboarding.equipmentOptions', (equipment) => setDraft({ ...draft, equipment }))}

      {step === TOTAL_STEPS && (
        <>
          {FOODS.map((food) => {
            const selected = (draft.foodPreferences ?? []).includes(food);
            return (
              <TouchableOpacity
                key={food}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => toggleFood(food)}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{t(`onboarding.foodOptions.${food}`)}</Text>
              </TouchableOpacity>
            );
          })}
          <Text style={styles.label}>{t('welcome.language')}</Text>
          {options(LANGUAGES, draft.language ?? currentLanguage(), 'onboarding.languages', chooseLanguage)}
        </>
      )}

      {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}

      <View style={styles.footer}>
        {step > 1 && (
          <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={onBack} disabled={submitting}>
            <Text style={styles.secondaryButtonText}>{t('onboarding.back')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.button, styles.primaryButton, (!canProceed || submitting) && styles.disabled]}
          onPress={onNext}
          disabled={!canProceed || submitting}
        >
          {submitting ? (
            <ActivityIndicator color={tokens.color.bg} />
          ) : (
            <Text style={styles.primaryButtonText}>{t(step === TOTAL_STEPS ? 'onboarding.finish' : 'onboarding.next')}</Text>
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity accessibilityRole="button" style={styles.signOut} onPress={() => void signOut()} disabled={submitting}>
        <Text style={styles.signOutText}>{t('settings.signOut')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const MUTED = '#8892A0';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: tokens.space[5], paddingTop: tokens.space[7] },
  center: { flex: 1, backgroundColor: tokens.color.bg, alignItems: 'center', justifyContent: 'center' },
  progress: { color: MUTED, fontSize: 14, marginBottom: tokens.space[2] },
  title: { color: tokens.color.text, fontSize: 28, fontWeight: '700', marginBottom: tokens.space[5] },
  row: { flexDirection: 'row', gap: tokens.space[2], marginBottom: tokens.space[3] },
  field: { marginBottom: tokens.space[3] },
  label: { color: MUTED, fontSize: 14, marginBottom: tokens.space[1], marginTop: tokens.space[2] },
  input: {
    backgroundColor: tokens.color.surface,
    color: tokens.color.text,
    borderRadius: 8,
    paddingHorizontal: tokens.space[4],
    minHeight: tokens.minTap,
    fontSize: 16,
  },
  errorText: { color: '#FF6B6B', marginTop: tokens.space[1], marginBottom: tokens.space[2] },
  option: {
    minHeight: tokens.minTap,
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: tokens.space[4],
    marginBottom: tokens.space[3],
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: '#2D3748',
    flexShrink: 1,
  },
  optionSelected: { borderColor: tokens.color.accent },
  optionText: { color: tokens.color.text, fontSize: 16 },
  optionTextSelected: { color: tokens.color.accent, fontWeight: '600' },
  footer: { flexDirection: 'row', gap: tokens.space[3], marginTop: tokens.space[4] },
  button: { flex: 1, minHeight: tokens.minTap, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { backgroundColor: tokens.color.accent },
  primaryButtonText: { color: tokens.color.bg, fontWeight: '600', fontSize: 16 },
  secondaryButton: { backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: '#2D3748' },
  secondaryButtonText: { color: tokens.color.text, fontSize: 16 },
  disabled: { opacity: 0.5 },
  signOut: { minHeight: tokens.minTap, alignItems: 'center', justifyContent: 'center', marginTop: tokens.space[4] },
  signOutText: { color: MUTED, fontSize: 16 },
});
