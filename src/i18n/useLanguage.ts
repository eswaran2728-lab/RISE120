import { useSyncExternalStore } from 'react';
import i18next from './index';

function subscribe(onChange: () => void): () => void {
  i18next.on('languageChanged', onChange);
  return () => i18next.off('languageChanged', onChange);
}

// t() is not reactive; call this in a screen so it re-renders when the language changes.
export function useLanguage(): string {
  return useSyncExternalStore(subscribe, () => i18next.language);
}
