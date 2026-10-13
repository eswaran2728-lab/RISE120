import React from 'react';
import { Tabs } from 'expo-router';
import { t } from '../../src/i18n';
import { useLanguage } from '../../src/i18n/useLanguage';
import { tokens } from '../../src/theme/tokens';

export default function TabsLayout() {
  useLanguage();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: tokens.color.surface, borderTopWidth: 0 },
        tabBarActiveTintColor: tokens.color.accent,
      }}
    >
      <Tabs.Screen name="today" options={{ title: t('today.title') }} />
      <Tabs.Screen name="workout" options={{ title: t('tabs.workout') }} />
    </Tabs>
  );
}
