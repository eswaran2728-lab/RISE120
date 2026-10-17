import React from 'react';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { t } from '../../src/i18n';
import { useLanguage } from '../../src/i18n/useLanguage';
import { tokens } from '../../src/theme/tokens';
import { TabIcon, TabIconName } from '../../src/ui/TabIcon';

const icon = (name: TabIconName) =>
  function Icon({ color, size }: { color: ColorValue; size: number }) {
    return <TabIcon name={name} color={color} size={size} />;
  };

export default function TabsLayout() {
  useLanguage();
  const screen = (name: TabIconName, title: string) => ({ title, tabBarAccessibilityLabel: title, tabBarIcon: icon(name) });
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: tokens.color.bg },
        tabBarStyle: {
          backgroundColor: tokens.color.surface,
          borderTopColor: tokens.color.border,
          borderTopWidth: 1,
          minHeight: 64,
          paddingTop: tokens.space[1],
          paddingBottom: tokens.space[1],
        },
        tabBarItemStyle: { minHeight: tokens.minTap, borderRadius: tokens.radius.control, marginHorizontal: tokens.space[1] },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarAllowFontScaling: true,
        tabBarActiveTintColor: tokens.color.accent,
        tabBarInactiveTintColor: tokens.color.textSecondary,
        tabBarActiveBackgroundColor: tokens.color.accentSoft,
      }}
    >
      <Tabs.Screen name="today" options={screen('today', t('today.title'))} />
      <Tabs.Screen name="workout" options={screen('workout', t('tabs.workout'))} />
      <Tabs.Screen name="food" options={screen('food', t('tabs.food'))} />
      <Tabs.Screen name="coach" options={screen('coach', t('tabs.coach'))} />
      <Tabs.Screen name="progress" options={screen('progress', t('tabs.progress'))} />
    </Tabs>
  );
}
