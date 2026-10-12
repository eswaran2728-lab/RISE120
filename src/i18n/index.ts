import * as Localization from 'expo-localization';
import i18next, { t as translate, use as registerPlugin } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import ms from './locales/ms.json';
import ta from './locales/ta.json';

const supported = ['en', 'ms', 'ta'] as const;
const deviceLanguage = Localization.getLocales()[0]?.languageCode;
const language = supported.find((candidate) => candidate === deviceLanguage) ?? 'en';

void registerPlugin(initReactI18next).init({
  resources: { en: { translation: en }, ms: { translation: ms }, ta: { translation: ta } },
  lng: language,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export const t = (key: string): string => translate(key);
export default i18next;
