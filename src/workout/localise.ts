import type { Localised } from './catalogue';

export type Language = 'en' | 'ms' | 'ta';

// Reviewed text is stored in all three languages. An unknown language falls back to English, never to nothing.
export function pick(text: Localised, language: string): string {
  return language === 'ms' ? text.ms : language === 'ta' ? text.ta : text.en;
}
