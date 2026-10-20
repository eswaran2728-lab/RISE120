import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { cancelReminders } from '../notifications/adapter';
import { expoNotificationApi } from '../notifications/expoApi';
import { supabase } from '../lib/supabase';
import { clearDraft } from '../onboarding/draft';
import { clearPending } from '../sync/queue';
import { removeFoodPhotos } from '../food/photo/files';
import { clearUserCache } from '../cache/userCache';
import { removeLocalPhotos } from '../checkin/photos';

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
if (webClientId) {
  try {
    GoogleSignin.configure({ webClientId });
  } catch {
    // Handled in environments without native Google Play services
  }
}

// needsConfirmation is true when the project requires email confirmation (no session yet).
export async function signUpWithEmail(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    throw new Error(error.message);
  }
  return { needsConfirmation: !data?.session };
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(error.message);
  }
}

export async function signInWithGoogle(): Promise<void> {
  await GoogleSignin.hasPlayServices();
  const response = await GoogleSignin.signIn();
  if (response.type === 'cancelled') return;
  const idToken = response.data?.idToken;
  if (!idToken) {
    throw new Error('No ID token present in Google sign in response');
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });

  if (error) {
    throw new Error(error.message);
  }
}

// A reminder belongs to the person who set it. Cancelling is best effort: a device that refuses must never stop
// someone signing out or deleting their account.
async function dropReminders(): Promise<void> {
  try {
    await cancelReminders(expoNotificationApi);
  } catch {
    // Nothing to do; the next sign-in reschedules from that account's own preferences.
  }
}

export async function signOut(): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error(error.message);
  }
  // An unsent food photo belongs to the account that took it; never leave it on the phone for the next one.
  if (userId) {
    try {
      removeFoodPhotos(userId);
    } catch {
      // Best effort: signing out must not fail because a local file could not be removed.
    }
  }
  // A draft belongs to the person who started it; never carry it to the next account.
  await clearDraft();
  await dropReminders();
}

export async function deleteAccount(): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error) {
    throw new Error(error.message);
  }
  try {
    await clearDraft();
    // Deleted account: drop its unsynced offline entries, cached data and local photos too.
    if (userId) {
      await clearPending(userId);
      await clearUserCache(userId);
      removeLocalPhotos(userId);
      removeFoodPhotos(userId);
    }
  } catch {
    // Best effort: the account is already deleted, so a local cleanup failure must not surface.
  }
  // The auth user is gone server-side, so only clear the local session.
  await supabase.auth.signOut({ scope: 'local' });
  await dropReminders();
}
