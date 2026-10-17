import React from 'react';
import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// Plain line icons for the five tabs. The colour comes from the tab bar (selected or not), so the icon never
// carries meaning by colour alone: every tab also has its text label.
export type TabIconName = 'today' | 'workout' | 'food' | 'coach' | 'progress';

const PATHS: Record<TabIconName, string[]> = {
  today: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
  workout: ['M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11'],
  food: ['M3 12h18a9 9 0 0 1-18 0z', 'M8 4c0 2 2 2 2 4M13 4c0 2 2 2 2 4'],
  coach: ['M4 5h16v11H9l-5 4z'],
  progress: ['M4 20V4M4 20h16', 'M8 15l4-4 3 3 5-6'],
};

export function TabIcon({ name, color, size = 24 }: { name: TabIconName; color: ColorValue; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}
