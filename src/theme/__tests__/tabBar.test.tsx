import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, create } from 'react-test-renderer';
import TabsLayout from '../../../app/(tabs)/_layout';
import { t } from '../../i18n';
import { tokens } from '../tokens';

type Options = Record<string, any>;
const mockScreens: { name: string; options: Options }[] = [];
let mockScreenOptions: Options = {};
jest.mock('expo-router', () => {
  function Tabs({ children, screenOptions }: { children: React.ReactNode; screenOptions: Options }) {
    mockScreenOptions = screenOptions;
    return <>{children}</>;
  }
  Tabs.Screen = function Screen({ name, options }: { name: string; options: Options }) {
    mockScreens.push({ name, options });
    return null;
  };
  return { Tabs };
});

const render = async () => {
  mockScreens.length = 0;
  await act(async () => {
    create(<TabsLayout />);
  });
};
const flat = (style: unknown): Record<string, any> => Object.assign({}, ...[style].flat(5).filter(Boolean));

describe('bottom tab bar', () => {
  it('keeps the five tabs and their order', async () => {
    await render();

    expect(mockScreens.map((s) => s.name)).toEqual(['today', 'workout', 'food', 'coach', 'progress']);
  });

  it('uses the theme tokens: midnight bar, gold selected tab, readable inactive tabs', async () => {
    await render();

    expect(flat(mockScreenOptions.tabBarStyle).backgroundColor).toBe(tokens.color.surface);
    expect(flat(mockScreenOptions.tabBarStyle).borderTopColor).toBe(tokens.color.border);
    expect(mockScreenOptions.tabBarActiveTintColor).toBe(tokens.color.accent);
    expect(mockScreenOptions.tabBarInactiveTintColor).toBe(tokens.color.textSecondary);
    expect(mockScreenOptions.tabBarActiveBackgroundColor).toBe(tokens.color.accentSoft);
    expect(flat(mockScreenOptions.sceneStyle).backgroundColor).toBe(tokens.color.bg);
  });

  it('makes every tab at least 48 points tall and lets labels scale with the text size', async () => {
    await render();

    expect(flat(mockScreenOptions.tabBarItemStyle).minHeight).toBeGreaterThanOrEqual(tokens.minTap);
    expect(flat(mockScreenOptions.tabBarStyle).minHeight ?? flat(mockScreenOptions.tabBarStyle).height).toBeGreaterThanOrEqual(tokens.minTap);
    expect(flat(mockScreenOptions.tabBarLabelStyle).fontSize).toBeGreaterThanOrEqual(12);
    expect(mockScreenOptions.tabBarAllowFontScaling).not.toBe(false);
  });

  it('gives every tab a translated title, an accessibility label and a line icon that takes the tab colour', async () => {
    await render();

    for (const screen of mockScreens) {
      const title = screen.options.title as string;
      expect(title).toBeTruthy();
      expect(title).not.toMatch(/^(tabs|today)\./); // a real translation, not a missing key
      expect(screen.options.tabBarAccessibilityLabel).toBe(title);
      const icon = screen.options.tabBarIcon({ color: '#123456', size: 24, focused: false });
      let tree!: ReturnType<typeof create>;
      await act(async () => {
        tree = create(icon);
      });
      expect(JSON.stringify(tree.toJSON())).toContain('#123456');
    }
    expect(mockScreens.find((s) => s.name === 'today')?.options.title).toBe(t('today.title'));
  });

  it('has the five distinct icons', async () => {
    await render();

    const drawn = await Promise.all(
      mockScreens.map(async (s) => {
        let tree!: ReturnType<typeof create>;
        await act(async () => {
          tree = create(s.options.tabBarIcon({ color: 'red', size: 24, focused: true }));
        });
        return JSON.stringify(tree.toJSON());
      })
    );
    expect(new Set(drawn).size).toBe(5);
  });
});

describe('colours come from the theme', () => {
  it.each(['app/(tabs)/_layout.tsx', 'app/(tabs)/today.tsx', 'src/ui/JourneyArc.tsx', 'src/ui/TabIcon.tsx'])('%s has no colour literals', (file) => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../..', file), 'utf8');

    expect(source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(source).not.toMatch(/rgba?\(/);
  });
});
