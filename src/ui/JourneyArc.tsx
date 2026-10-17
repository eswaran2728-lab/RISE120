import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { tokens } from '../theme/tokens';

// A sunrise arc for the journey day. It shows where today sits in the calendar and nothing else: it takes no
// task-completion input, because finishing a day's tasks is shown separately on the Today screen.
interface Props {
  day: number;
  total: number;
  label: string; // spoken label, already translated ("Journey day 18 of 120")
  dayText: string; // visible text, already translated ("Day 18 of 120")
  caption: string; // already translated
}

// The semicircle runs left to right through the top. These match the reference design's 320 x 125 box.
const CENTER = { x: 160, y: 112 };
const RADIUS = 135;
const STROKE = 13;
const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 125;

// Point on the arc at progress 0 (left end) to 1 (right end); anything outside is clamped.
export function arcPoint(progress: number): { x: number; y: number } {
  const p = Math.min(1, Math.max(0, progress));
  return { x: CENTER.x - RADIUS * Math.cos(Math.PI * p), y: CENTER.y - RADIUS * Math.sin(Math.PI * p) };
}

export function JourneyArc({ day, total, label, dayText, caption }: Props) {
  const now = Math.min(total, Math.max(0, day));
  const progress = total > 0 ? now / total : 0;
  const start = arcPoint(0);
  const end = arcPoint(1);
  const sun = arcPoint(progress);

  return (
    <View
      style={styles.card}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: total, now, text: dayText }}
    >
      <Svg width="100%" height={95} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
        <Path d={`M${start.x} ${start.y} A${RADIUS} ${RADIUS} 0 0 1 ${end.x} ${end.y}`} fill="none" stroke={tokens.color.border} strokeWidth={STROKE} strokeLinecap="round" />
        {progress > 0 ? (
          <Path d={`M${start.x} ${start.y} A${RADIUS} ${RADIUS} 0 0 1 ${sun.x} ${sun.y}`} fill="none" stroke={tokens.color.accent} strokeWidth={STROKE} strokeLinecap="round" />
        ) : null}
        <Circle cx={sun.x} cy={sun.y} r={9} fill={tokens.color.accent} stroke={tokens.color.surface} strokeWidth={3} />
      </Svg>
      <Text style={styles.day}>{dayText}</Text>
      <Text style={styles.caption}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.color.surface,
    borderColor: tokens.color.border,
    borderWidth: 1,
    borderRadius: tokens.radius.card,
    alignItems: 'center',
    padding: tokens.space[4],
    marginBottom: tokens.space[4],
  },
  day: { color: tokens.color.text, fontSize: 24, fontWeight: '700', marginTop: tokens.space[1] },
  caption: { color: tokens.color.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
