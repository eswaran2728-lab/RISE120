import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { tokens } from '../theme/tokens';
import type { Localised } from '../workout/catalogue';
import { pick } from '../workout/localise';
import { ActionButton } from './ActionButton';
import { SectionCard } from './SectionCard';

interface Option {
  id: string;
  name: Localised;
  equipment: string;
}

interface Props {
  currentName: Localised;
  options: Option[];
  doneSets: number; // sets already logged for the exercise: they stay exactly as they are
  remainingSets: number; // sets still to do: only these move to the replacement
  language: string;
  message?: string | null;
  onConfirm: (replacementId: string) => Promise<unknown>;
}

const EQUIPMENT_KEY: Record<string, string> = { none: 'exercise.equipmentNone', home: 'exercise.equipmentHome', gym: 'exercise.equipmentGym' };

// Choose a replacement for the sets that are left. Nothing changes until a choice is reviewed and confirmed, and
// when no suitable swap exists the member just keeps the exercise.
export function SwapSheet({ currentName, options, doneSets, remainingSets, language, message, onConfirm }: Props) {
  const [chosen, setChosen] = useState<Option | null>(null);

  let body: React.ReactNode;
  if (remainingSets <= 0) {
    body = <Text style={styles.note}>{t('exercise.nothingLeft')}</Text>;
  } else if (options.length === 0) {
    body = <Text style={styles.note}>{t('exercise.noSwap')}</Text>;
  } else if (chosen) {
    body = (
      <>
        <Text style={styles.body}>{t('exercise.swapReview', { done: doneSets, remaining: remainingSets, name: pick(chosen.name, language) })}</Text>
        <ActionButton testID="swap-confirm" label={t('exercise.swapConfirm')} onPress={() => onConfirm(chosen.id)} />
        <ActionButton testID="swap-cancel" variant="link" label={t('exercise.swapCancel')} onPress={() => setChosen(null)} />
      </>
    );
  } else {
    body = (
      <>
        <Text style={styles.note}>{t('exercise.pickSwap')}</Text>
        {options.map((option) => (
          <View key={option.id} style={styles.option}>
            <ActionButton
              testID={`swap-option-${option.id}`}
              variant="secondary"
              label={`${pick(option.name, language)} · ${t(EQUIPMENT_KEY[option.equipment] ?? 'exercise.equipmentNone')}`}
              onPress={() => setChosen(option)}
            />
          </View>
        ))}
      </>
    );
  }

  return (
    <SectionCard title={t('exercise.swapTitle', { name: pick(currentName, language) })}>
      {body}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{message}</Text> : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  body: { color: tokens.color.text, fontSize: 16, lineHeight: 24, marginVertical: tokens.space[2] },
  note: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginVertical: tokens.space[2] },
  option: { marginTop: tokens.space[2] },
  warning: { color: tokens.color.warning, fontSize: 16, lineHeight: 24, marginTop: tokens.space[2] },
});
