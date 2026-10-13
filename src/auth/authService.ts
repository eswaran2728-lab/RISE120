import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { supabase } from '../lib/supabase';

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
if (webClientId) {
  try {
    GoogleSignin.configure({ webClientId });
  } catch {
    // Handled in environments without native Google Play services
  }
}

export async function signUpWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    throw new Error(error.message);
  }
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

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error) {
    throw new Error(error.message);
  }
  // The auth user is gone server-side, so only clear the local session.
  await supabase.auth.signOut({ scope: 'local' });
}
