import i18next, { t } from '../index';

describe('t() with values', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });

  it('fills named values into a translation, in each language', async () => {
    expect(t('today.dayOfTotal', { day: 18, total: 120 })).toBe('Day 18 of 120');
    await i18next.changeLanguage('ms');
    expect(t('today.dayOfTotal', { day: 18, total: 120 })).toContain('18');
    expect(t('today.dayOfTotal', { day: 18, total: 120 })).not.toContain('{{');
    await i18next.changeLanguage('ta');
    expect(t('today.dayOfTotal', { day: 18, total: 120 })).toContain('120');
    expect(t('today.dayOfTotal', { day: 18, total: 120 })).not.toContain('{{');
  });

  it('keeps working without values', () => {
    expect(t('today.title')).toBe('Today');
  });
});
