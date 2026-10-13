import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { chartPoints } from '../progress/chart';
import { tokens } from '../theme/tokens';
import type { LocalDate } from '../sync/types';

interface Props {
  points: { date: LocalDate; weightKg: number; pending: boolean }[];
  width: number;
  height?: number;
  formatWeight: (kg: number) => string; // e.g. "70.5 kg"
  label: string; // accessibility label, already translated
}

export function WeightChart({ points, width, height = 160, formatWeight, label }: Props) {
  const padding = 16;
  const coords = chartPoints(points, { width, height, padding });
  const weights = points.map((p) => p.weightKg);
  const summary =
    points.length === 0
      ? label
      : `${label}: ${points[0].date} ${formatWeight(points[0].weightKg)}, ${points[points.length - 1].date} ${formatWeight(points[points.length - 1].weightKg)}`;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary}>
      <Svg width={width} height={height}>
        {coords.length > 1 ? (
          <Polyline points={coords.map((c) => `${c.x},${c.y}`).join(' ')} fill="none" stroke={tokens.color.accent} strokeWidth={2} />
        ) : null}
        {coords.map((c, i) => (
          <Circle
            key={`${points[i].date}-${i}`}
            cx={c.x}
            cy={c.y}
            r={5}
            fill={points[i].pending ? tokens.color.bg : tokens.color.accent}
            stroke={tokens.color.accent}
            strokeWidth={2}
          />
        ))}
      </Svg>
      {weights.length > 0 ? (
        <View style={styles.axis}>
          <Text style={styles.axisText}>{formatWeight(Math.min(...weights))}</Text>
          <Text style={styles.axisText}>{formatWeight(Math.max(...weights))}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: tokens.space[1] },
  axisText: { color: '#8892A0', fontSize: 12 },
});
