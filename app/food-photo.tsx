import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Href, useFocusEffect, useRouter } from 'expo-router';
import { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { withAccountKey } from '../src/auth/withAccountKey';
import { randomId } from '../src/lib/randomId';
import { useLocalDate } from '../src/lib/useLocalDate';
import { capabilitiesOf, loadLimitsOrCached } from '../src/monetization/limits';
import { flushPending } from '../src/sync/flush';
import { supabaseTransport } from '../src/sync/supabaseTransport';
import { newLogId } from '../src/food/log';
import { foodSourceLabel, defaultMealFor } from '../src/food/summary';
import type { Food } from '../src/food/types';
import { analysePhoto, AnalysisResult, removeUploadedFoodPhoto, uploadFoodPhoto } from '../src/food/photo/api';
import { removeLocalFoodPhoto, saveFoodPhotoLocal } from '../src/food/photo/files';
import { Candidate, confirmPhotoCandidate, foodForSelection, resolveCandidate, Selected } from '../src/food/photo/review';
import { FoodEntry } from '../src/ui/FoodEntry';
import { ActionButton } from '../src/ui/ActionButton';
import { AsyncState } from '../src/ui/AsyncState';
import { ScreenFrame } from '../src/ui/ScreenFrame';
import { SectionCard } from '../src/ui/SectionCard';

type Access = 'loading' | 'allowed' | 'premium' | 'unknown';
type Phase =
  | { name: 'start' }
  | { name: 'working'; stage: 'preparing' | 'sending' | 'analysing' }
  | { name: 'result'; textKey: string; retry: boolean }
  | { name: 'review'; candidates: Candidate[]; notice: string | null }
  | { name: 'entry'; candidates: Candidate[]; candidate: Candidate; selected: Selected; food: Food; entryId: string };

const RESULT_TEXT: Record<string, string> = {
  no_match: 'food.photo.noMatch',
  in_progress: 'food.photo.inProgress',
  limited: 'food.photo.limited',
  invalid_image: 'food.photo.invalidImage',
  failed: 'food.photo.failed',
  unknown: 'food.photo.unknown',
  offline: 'food.photo.offline',
  error: 'food.photo.failed',
};

function textKeyFor(result: Exclude<AnalysisResult, { kind: 'ok' }>): string {
  if (result.kind === 'unavailable') return result.reason === 'premium_required' ? 'food.photo.premiumOnly' : 'food.photo.unavailable';
  return RESULT_TEXT[result.kind] ?? 'food.photo.failed';
}

// Log a meal from a photo, in the member's hands at every step: permission, capture, candidate review, portion
// correction, a nutrition and source preview, and an explicit Save. The server only suggests references to sourced foods
// and reviewed recipes; nothing is logged, and no calorie figure exists, until the member chooses a food, corrects the
// amount and presses Save. Manual food search is always one tap away.
function FoodPhotoScreen() {
  useLanguage();
  const router = useRouter();
  const date = useLocalDate();
  const { session } = useSession();
  const userId = session?.user?.id;
  const [access, setAccess] = useState<Access>('loading');
  const [phase, setPhase] = useState<Phase>({ name: 'start' });
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const alive = useRef(true);
  const saveGuard = useRef(false);
  // The photo being processed: one request id for all its retries, the local file until it has been sent, and whether the
  // server has given a definite answer (after which it has already deleted the image).
  const current = useRef<{ requestId: string; localUri: string | null; uploaded: boolean; answered: boolean } | null>(null);
  const run = useRef(0);

  const cleanUp = useCallback(() => {
    const pending = current.current;
    current.current = null;
    if (!pending || !userId) return;
    if (pending.localUri) {
      try {
        removeLocalFoodPhoto(pending.localUri);
      } catch {
        // The system clears its own cache.
      }
    }
    if (pending.uploaded && !pending.answered) void removeUploadedFoodPhoto(userId, pending.requestId);
  }, [userId]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      run.current += 1; // anything still in flight now belongs to nobody
      cleanUp();
    };
  }, [cleanUp]);

  const checkAccess = useCallback(async () => {
    if (!userId) return;
    setAccess('loading');
    const limits = await loadLimitsOrCached(userId).catch(() => null);
    if (!alive.current) return;
    setAccess(limits === null ? 'unknown' : capabilitiesOf(limits.snapshot).photoFood ? 'allowed' : 'premium');
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void checkAccess();
    }, [checkAccess])
  );

  if (!userId) return <AsyncState state={{ kind: 'error', message: t('errors.generic') }} />;
  if (access === 'loading') return <AsyncState state={{ kind: 'loading' }} />;

  const manual = () => router.push('/food-search' as Href);
  const live = (id: number) => alive.current && run.current === id;

  // Sends the photo (if it has not been sent) and asks for candidates, under the request id of this photo.
  const sendAndAnalyse = async (id: number) => {
    const pending = current.current;
    if (!pending) return;
    if (!pending.uploaded) {
      setPhase({ name: 'working', stage: 'sending' });
      const sent = pending.localUri ? await uploadFoodPhoto(userId, pending.requestId, pending.localUri) : ({ kind: 'error' } as const);
      if (!live(id)) return;
      if (sent.kind !== 'ok') return setPhase({ name: 'result', textKey: sent.kind === 'offline' ? 'food.photo.offline' : 'food.photo.failed', retry: true });
      pending.uploaded = true;
      if (pending.localUri) {
        removeLocalFoodPhoto(pending.localUri);
        pending.localUri = null;
      }
    }
    setPhase({ name: 'working', stage: 'analysing' });
    const result = await analysePhoto(userId, pending.requestId);
    if (!live(id)) return;
    // A definite answer means the server has deleted the image. offline, error and in_progress leave it for a retry.
    if (result.kind !== 'offline' && result.kind !== 'error' && result.kind !== 'in_progress') pending.answered = true;
    if (result.kind === 'ok') return setPhase({ name: 'review', candidates: result.candidates, notice: null });
    setPhase({ name: 'result', textKey: textKeyFor(result), retry: result.kind === 'offline' || result.kind === 'error' || result.kind === 'in_progress' });
  };

  const take = async (source: 'camera' | 'library') => {
    setMessage(null);
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!alive.current) return;
      if (!permission.granted) return setMessage(t('food.photo.permissionDenied'));
    }
    const picked =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!alive.current || picked.canceled || !picked.assets?.[0]) return;

    cleanUp();
    const id = ++run.current;
    current.current = { requestId: randomId(), localUri: null, uploaded: false, answered: false };
    setPhase({ name: 'working', stage: 'preparing' });
    const asset = picked.assets[0];
    try {
      const local = await saveFoodPhotoLocal(userId, asset.uri, asset.width, asset.height);
      if (!live(id)) {
        removeLocalFoodPhoto(local);
        return;
      }
      if (current.current) current.current.localUri = local;
    } catch {
      if (live(id)) setPhase({ name: 'result', textKey: 'food.photo.invalidImage', retry: false });
      return;
    }
    await sendAndAnalyse(id);
  };

  const retry = async () => {
    const id = ++run.current;
    await sendAndAnalyse(id);
  };

  const choose = async (candidate: Candidate, candidates: Candidate[]) => {
    if (!candidate.loggable) return;
    const resolved = await resolveCandidate(userId, candidate);
    if (!alive.current) return;
    if (resolved.kind === 'gone') return setPhase({ name: 'review', candidates, notice: t('food.photo.gone') });
    if (resolved.kind === 'offline') return setPhase({ name: 'review', candidates, notice: t('food.photo.offline') });
    const food = foodForSelection(userId, resolved.selected);
    if (!food) return setPhase({ name: 'review', candidates, notice: t('food.photo.unloggable') });
    setSaveError(null);
    setPhase({ name: 'entry', candidates, candidate, selected: resolved.selected, food, entryId: newLogId() });
  };

  const save = async (quantity: number, meal: Parameters<typeof confirmPhotoCandidate>[4]) => {
    if (phase.name !== 'entry' || saveGuard.current) return;
    saveGuard.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await confirmPhotoCandidate(userId, date, phase.selected, quantity, meal, phase.entryId);
      if (!alive.current) return;
      if (result.kind !== 'logged') {
        setSaveError(t(result.kind === 'invalid_quantity' ? 'food.entry.saveError' : 'food.photo.unloggable'));
        return;
      }
      void Promise.resolve(flushPending(userId, supabaseTransport)).catch(() => undefined);
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/food' as Href);
    } catch {
      if (alive.current) setSaveError(t('food.entry.saveError'));
    } finally {
      saveGuard.current = false;
      if (alive.current) setSaving(false);
    }
  };

  if (phase.name === 'entry') {
    return (
      <ScreenFrame>
        <Text style={styles.note}>{t('food.photo.estimateNote')}</Text>
        <FoodEntry
          food={phase.food}
          initialQuantity={phase.candidate.servings !== null ? String(phase.candidate.servings) : '1'}
          initialMeal={defaultMealFor(new Date())}
          submitLabelKey="food.entry.add"
          busy={saving}
          error={saveError}
          onSubmit={save}
          onCancel={() => setPhase({ name: 'review', candidates: phase.candidates, notice: null })}
        />
      </ScreenFrame>
    );
  }

  const starting = phase.name === 'start' || phase.name === 'result';
  const sourceText = (candidate: Candidate) => {
    if (candidate.kind === 'recipe') return t('food.photo.recipeSource');
    const label = foodSourceLabel({ source: candidate.provenance.source, verified: candidate.provenance.verified } as Food);
    return `${t(label.key)}${label.verified ? ` · ${t('food.verified')}` : ''}`;
  };

  return (
    <ScreenFrame>
      <ActionButton variant="link" label={t('onboarding.back')} onPress={() => router.back()} />
      <Text accessibilityRole="header" style={styles.title}>{t('food.photo.title')}</Text>
      <Text style={styles.note}>{t('food.photo.intro')}</Text>

      {access === 'premium' ? (
        <SectionCard>
          <Text style={styles.body}>{t('food.photo.premiumOnly')}</Text>
          <ActionButton testID="photo-upgrade" variant="secondary" label={t('planner.upgrade')} onPress={() => router.push('/paywall' as Href)} />
        </SectionCard>
      ) : null}

      {access === 'unknown' ? (
        <SectionCard>
          <Text accessibilityLiveRegion="polite" style={styles.warning}>{t('food.photo.accessUnknown')}</Text>
          <ActionButton testID="photo-retry-access" variant="secondary" label={t('food.photo.retryAccess')} onPress={checkAccess} />
        </SectionCard>
      ) : null}

      {access === 'allowed' && starting ? (
        <SectionCard>
          <ActionButton testID="photo-take" label={t('food.photo.take')} onPress={() => take('camera')} />
          <ActionButton testID="photo-choose" variant="secondary" label={t('food.photo.choose')} onPress={() => take('library')} />
        </SectionCard>
      ) : null}

      {message ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{message}</Text> : null}

      {phase.name === 'working' ? (
        <SectionCard>
          <ActivityIndicator color={tokens.color.accent} />
          <Text accessibilityLiveRegion="polite" style={styles.body}>{t(`food.photo.${phase.stage === 'preparing' ? 'preparing' : phase.stage === 'sending' ? 'sending' : 'analysing'}`)}</Text>
        </SectionCard>
      ) : null}

      {phase.name === 'result' ? (
        <SectionCard>
          <Text accessibilityLiveRegion="polite" style={styles.warning}>{t(phase.textKey)}</Text>
          {phase.retry ? <ActionButton testID="photo-retry" variant="secondary" label={t('food.photo.retry')} onPress={retry} /> : null}
        </SectionCard>
      ) : null}

      {phase.name === 'review' ? (
        <SectionCard title={t('food.photo.candidatesTitle')}>
          {phase.notice ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{phase.notice}</Text> : null}
          {phase.candidates.map((candidate) => (
            <View key={`${candidate.kind}-${candidate.id}`} style={styles.candidate}>
              <Text style={styles.name}>{candidate.name}</Text>
              <Text style={styles.note}>{t(`food.photo.${candidate.uncertainty}`)}</Text>
              <Text style={styles.note}>{sourceText(candidate)}</Text>
              {candidate.servings !== null ? <Text style={styles.note}>{t('food.photo.suggested', { count: candidate.servings })}</Text> : null}
              {candidate.loggable ? (
                <ActionButton testID={`photo-candidate-${candidate.id}`} variant="secondary" label={candidate.name} onPress={() => choose(candidate, phase.candidates)} />
              ) : (
                <Text style={styles.warning}>{t('food.photo.unloggable')}</Text>
              )}
            </View>
          ))}
          <ActionButton testID="photo-another" variant="link" label={t('food.photo.another')} onPress={() => { cleanUp(); setPhase({ name: 'start' }); }} />
        </SectionCard>
      ) : null}

      <ActionButton testID="photo-manual" variant="secondary" label={t('food.photo.manual')} onPress={manual} />
    </ScreenFrame>
  );
}

export default withAccountKey(FoodPhotoScreen);

const styles = StyleSheet.create({
  title: { color: tokens.color.text, fontSize: 28, lineHeight: 36, fontWeight: '700', marginBottom: tokens.space[2] },
  body: { color: tokens.color.text, fontSize: 16, lineHeight: 24, marginVertical: tokens.space[1] },
  name: { color: tokens.color.text, fontSize: 18, lineHeight: 27, fontWeight: '600' },
  note: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginVertical: tokens.space[1] },
  warning: { color: tokens.color.warning, fontSize: 16, lineHeight: 24, marginVertical: tokens.space[2] },
  candidate: { marginTop: tokens.space[3], paddingTop: tokens.space[2], borderTopWidth: 1, borderTopColor: tokens.color.border },
});
