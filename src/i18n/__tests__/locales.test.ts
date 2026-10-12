import en from '../locales/en.json';
import ms from '../locales/ms.json';
import ta from '../locales/ta.json';

const languages = ['en', 'ms', 'ta'] as const;

function flatten(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(value).reduce<Record<string, string>>((result, [key, entry]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === 'string') result[path] = entry;
    else if (entry && typeof entry === 'object') Object.assign(result, flatten(entry as Record<string, unknown>, path));
    return result;
  }, {});
}

test('English, Malay, and Tamil have identical keys and no empty translations', () => {
  const translations = { en: flatten(en), ms: flatten(ms), ta: flatten(ta) };
  const expectedKeys = Object.keys(translations.en).sort();

  expect(expectedKeys.length).toBeGreaterThan(0);
  for (const language of languages) {
    expect(Object.keys(translations[language]).sort()).toEqual(expectedKeys);
    for (const value of Object.values(translations[language])) {
      expect(value.trim()).not.toBe('');
    }
  }
});
