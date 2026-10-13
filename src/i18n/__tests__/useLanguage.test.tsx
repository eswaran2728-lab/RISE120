import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import i18next, { t } from '../index';
import { useLanguage } from '../useLanguage';
import ms from '../locales/ms.json';

function Probe() {
  useLanguage();
  return <Text>{t('today.preparing')}</Text>;
}

describe('useLanguage', () => {
  afterEach(async () => {
    await act(async () => {
      await i18next.changeLanguage('en');
    });
  });

  it('re-renders a mounted screen when the language changes', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<Probe />);
    });
    expect(tree.root.findByType(Text).props.children).not.toBe(ms.today.preparing);

    await act(async () => {
      await i18next.changeLanguage('ms');
    });

    expect(tree.root.findByType(Text).props.children).toBe(ms.today.preparing);
  });
});
