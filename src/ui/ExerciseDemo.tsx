import React, { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { tokens } from '../theme/tokens';
import type { Localised, Media } from '../workout/catalogue';
import { pick } from '../workout/localise';
import { ActionButton } from './ActionButton';
import { SectionCard } from './SectionCard';

interface Props {
  exercise: { name: Localised; cues: Localised[]; media: Media | null };
  language: string;
  openUrl?: (url: string) => Promise<unknown>;
}

// How to do an exercise. The written cues are always here, so a missing or unreachable video never leaves the
// member without instructions. A video is only opened when the person asks for it, and only from an https link.
export function ExerciseDemo({ exercise, language, openUrl = (url) => Linking.openURL(url) }: Props) {
  const [failed, setFailed] = useState(false);
  const media = exercise.media;
  const url = media?.kind === 'video' && typeof media.url === 'string' && media.url.startsWith('https://') ? media.url : null;

  const open = async () => {
    if (!url) return;
    try {
      await openUrl(url);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <SectionCard title={pick(exercise.name, language)}>
      <Text style={styles.heading}>{t('exercise.cues')}</Text>
      {exercise.cues.map((cue, index) => (
        <Text key={index} style={styles.cue}>{`${index + 1}. ${pick(cue, language)}`}</Text>
      ))}
      <View style={styles.media}>
        {url ? (
          <>
            <ActionButton testID="exercise-video-open" variant="secondary" label={t('exercise.watchVideo')} onPress={open} />
            {media ? <Text style={styles.note}>{t('exercise.credit', { source: media.source })}</Text> : null}
          </>
        ) : (
          <Text testID="exercise-video-note" style={styles.note}>{t('exercise.noVideo')}</Text>
        )}
        {failed ? (
          <Text accessibilityLiveRegion="polite" style={styles.warning}>{t('exercise.videoUnavailable')}</Text>
        ) : null}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  heading: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginTop: tokens.space[2] },
  cue: { color: tokens.color.text, fontSize: 16, lineHeight: 24, marginTop: tokens.space[2] },
  media: { marginTop: tokens.space[3] },
  note: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, marginTop: tokens.space[2] },
  warning: { color: tokens.color.warning, fontSize: 16, lineHeight: 24, marginTop: tokens.space[2] },
});
