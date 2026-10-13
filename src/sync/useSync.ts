import { useEffect } from 'react';
import { AppState } from 'react-native';
import { flushPending } from './flush';
import { supabaseTransport } from './supabaseTransport';

const RETRY_INTERVAL_MS = 30000;

// Flushes the signed-in user's queue on mount, when the app returns to the foreground, and on a
// timer (covers reconnecting without needing a native network-status module).
export function useSync(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return;
    const flush = () => {
      void flushPending(userId, supabaseTransport).catch(() => undefined);
    };
    flush();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') flush();
    });
    const timer = setInterval(flush, RETRY_INTERVAL_MS);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [userId]);
}
