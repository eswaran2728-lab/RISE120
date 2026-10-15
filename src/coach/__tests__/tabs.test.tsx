import React from 'react';
import { act, create } from 'react-test-renderer';
import TabsLayout from '../../../app/(tabs)/_layout';
import { t } from '../../i18n';

const mockScreens: { name: string; title?: string }[] = [];
jest.mock('expo-router', () => {
  function Tabs({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  Tabs.Screen = function Screen({ name, options }: { name: string; options?: { title?: string } }) {
    mockScreens.push({ name, title: options?.title });
    return null;
  };
  return { Tabs };
});

describe('bottom tabs', () => {
  beforeEach(() => {
    mockScreens.length = 0;
  });

  it('has the tabs in order: Today, Workout, Food, Coach, Progress', async () => {
    await act(async () => {
      create(<TabsLayout />);
    });

    expect(mockScreens.map((s) => s.name)).toEqual(['today', 'workout', 'food', 'coach', 'progress']);
  });

  it('titles the Coach tab through the translations', async () => {
    await act(async () => {
      create(<TabsLayout />);
    });

    expect(mockScreens.find((s) => s.name === 'coach')?.title).toBe(t('tabs.coach'));
    expect(t('tabs.coach')).not.toBe('tabs.coach');
  });
});
