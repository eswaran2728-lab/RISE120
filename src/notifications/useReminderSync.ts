import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { onWorkoutSetLogged } from '../workout/events';
import { cancelRemindersNow, syncRemindersNow } from './now';

export interface ReminderSyncActions {
  sync: (userId: string | null) => Promise<unknown>;
  cancel: () => Promise<unknown>;
}

const real: ReminderSyncActions = { sync: syncRemindersNow, cancel: cancelRemindersNow };

// Keeps the scheduled reminders right without the person opening Settings: on launch, every return to the
// foreground, and whenever the signed-in account changes (the previous account's reminders are cancelled first).
// A failure is swallowed: the next launch or foreground tries again, and reminders must never break the app.
export function useReminderSync(userId: string | null, reminders: ReminderSyncActions = real): void {
  const actions = useRef(reminders);
  useEffect(() => {
    actions.current = reminders;
  });
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = userId;
    void (async () => {
      try {
        if (before && before !== userId) await actions.current.cancel();
        if (userId) await actions.current.sync(userId);
      } catch {
        // Retried on the next launch or foreground.
      }
    })();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void Promise.resolve(actions.current.sync(userId)).catch(() => undefined);
    });
    // Whether the workout is now complete is read from the stored sets by the sync, never assumed from this signal.
    const stopListening = onWorkoutSetLogged((loggedFor) => {
      if (loggedFor === userId) void Promise.resolve(actions.current.sync(userId)).catch(() => undefined);
    });
    return () => {
      subscription.remove();
      stopListening();
    };
  }, [userId]);
}
