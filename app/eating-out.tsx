import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Href, useFocusEffect, useRouter } from 'expo-router';
import { t } from '../src/i18n';
import { useLanguage } from '../src/i18n/useLanguage';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { withAccountKey } from '../src/auth/withAccountKey';
import type { Dish } from '../src/food/eatingOut';
import { loadDishes } from '../src/food/eatingOutData';
import { pick } from '../src/workout/localise';
import { ActionButton } from '../src/ui/ActionButton';
import { AsyncState } from '../src/ui/AsyncState';
import { ScreenFrame } from '../src/ui/ScreenFrame';
import { SectionCard } from '../src/ui/SectionCard';

// Guidance for choosing when eating out, for reviewed dishes only. It is general guidance, not a live menu: it never says
// a restaurant serves a dish, and calories are only ever an approximate range for the portion described.
function EatingOutScreen() {
  const language = useLanguage();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const [dishes, setDishes] = useState<Dish[] | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void loadDishes(userId).then((list) => alive.current && setDishes(list));
    }, [userId])
  );

  if (!userId) return <AsyncState state={{ kind: 'error', message: t('eatingOut.loadError') }} />;
  if (dishes === null) return <AsyncState state={{ kind: 'loading' }} />;

  return (
    <ScreenFrame>
      <ActionButton variant="link" label={t('onboarding.back')} onPress={() => router.back()} />
      <Text accessibilityRole="header" style={styles.title}>{t('eatingOut.title')}</Text>
      <Text style={styles.note}>{t('eatingOut.notLive')}</Text>

      {dishes.length === 0 ? (
        <SectionCard>
          <Text style={styles.body}>{t('eatingOut.empty')}</Text>
        </SectionCard>
      ) : (
        dishes.map((dish) => (
          <SectionCard key={dish.id} title={pick(dish.name, language)}>
            {dish.tips.map((tip, i) => (
              <Text key={i} style={styles.body}>{pick(tip, language)}</Text>
            ))}
            {dish.calories && dish.servingNote ? (
              <>
                <Text style={styles.body}>{t('eatingOut.range', { min: dish.calories.min, max: dish.calories.max })}</Text>
                <Text style={styles.note}>{pick(dish.servingNote, language)}</Text>
              </>
            ) : (
              <Text style={styles.note}>{t('eatingOut.caloriesUnknown')}</Text>
            )}
          </SectionCard>
        ))
      )}

      <ActionButton testID="eating-out-manual" variant="secondary" label={t('eatingOut.logByHand')} onPress={() => router.push('/food-search' as Href)} />
    </ScreenFrame>
  );
}

export default withAccountKey(EatingOutScreen);

const styles = StyleSheet.create({
  title: { color: tokens.color.text, fontSize: 28, lineHeight: 36, fontWeight: '700', marginBottom: tokens.space[2] },
  body: { color: tokens.color.text, fontSize: 16, lineHeight: 24, marginVertical: tokens.space[1] },
  note: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginVertical: tokens.space[1] },
});
