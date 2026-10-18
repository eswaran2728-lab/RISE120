import { signInWithEmail, signUpWithEmail, signOut, signInWithGoogle, deleteAccount } from '../authService';
import { supabase } from '../../lib/supabase';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { loadDraft, saveDraft } from '../../onboarding/draft';
import { enqueue, listPending } from '../../sync/queue';
import { removeLocalPhotos } from '../../checkin/photos';
import { readCache, writeCache } from '../../cache/userCache';
import { recentFoods, rememberFoods } from '../../food/cache';
import { expoNotificationApi } from '../../notifications/expoApi';


jest.mock('../../notifications/expoApi', () => ({
  expoNotificationApi: {
    cancel: jest.fn().mockResolvedValue(undefined),
    scheduledIds: jest.fn().mockResolvedValue(['rise120-reminder-2026-10-19T10:00:00.000Z', 'rise120-reminder-2026-10-20T10:00:00.000Z', 'other-feature']),
  },
}));
jest.mock('../../checkin/photos', () => ({ removeLocalPhotos: jest.fn() }));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      signInWithIdToken: jest.fn(),
      getSession: jest.fn(),
    },
    functions: { invoke: jest.fn() },
  },
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn().mockResolvedValue({
      data: {
        idToken: 'mock-google-id-token',
      },
    }),
  },
}));

describe('authService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: null } });
  });

  describe('signInWithEmail', () => {
    it('calls auth.signInWithPassword with the given email and password', async () => {
      (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValueOnce({
        data: { user: { id: 'u1' } },
        error: null,
      });

      await signInWithEmail('test@example.com', 'password123');

      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });

    it('throws Error with message when signInWithPassword returns an error', async () => {
      (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: { message: 'Invalid login credentials' },
      });

      await expect(signInWithEmail('test@example.com', 'wrongpassword')).rejects.toThrow(
        'Invalid login credentials'
      );
    });
  });

  describe('signUpWithEmail', () => {
    it('calls auth.signUp with the given email and password', async () => {
      (supabase.auth.signUp as jest.Mock).mockResolvedValueOnce({
        data: { user: { id: 'u2' } },
        error: null,
      });

      await signUpWithEmail('new@example.com', 'securepass');

      expect(supabase.auth.signUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'securepass',
      });
    });

    it('throws Error with message when signUp returns an error', async () => {
      (supabase.auth.signUp as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: { message: 'User already registered' },
      });

      await expect(signUpWithEmail('new@example.com', 'securepass')).rejects.toThrow(
        'User already registered'
      );
    });
  });

  describe('signOut', () => {
    it('calls auth.signOut', async () => {
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({
        error: null,
      });

      await signOut();

      expect(supabase.auth.signOut).toHaveBeenCalled();
    });

    it('throws Error with message when signOut returns an error', async () => {
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({
        error: { message: 'Network error during sign out' },
      });

      await expect(signOut()).rejects.toThrow('Network error during sign out');
    });
  });

  describe('signInWithGoogle', () => {
    it('calls signInWithIdToken with google id token', async () => {
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValueOnce({
        data: { user: { id: 'u3' } },
        error: null,
      });

      await signInWithGoogle();

      expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith({
        provider: 'google',
        token: 'mock-google-id-token',
      });
    });

    it('throws Error when signInWithIdToken returns an error', async () => {
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: { message: 'Google sign in failed' },
      });

      await expect(signInWithGoogle()).rejects.toThrow('Google sign in failed');
    });
  });

  describe('deleteAccount', () => {
    it('invokes the delete-account function, then signs out locally', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({ data: { deleted: true }, error: null });
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });

      await deleteAccount();

      expect(supabase.functions.invoke).toHaveBeenCalledWith('delete-account', { method: 'POST' });
      expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('throws and keeps the session when the function returns an error', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: { message: 'Could not delete account' },
      });

      await expect(deleteAccount()).rejects.toThrow('Could not delete account');

      expect(supabase.auth.signOut).not.toHaveBeenCalled();
    });
  });

  describe('review fixes', () => {
    it('reports that email confirmation is needed when sign-up returns no session', async () => {
      (supabase.auth.signUp as jest.Mock).mockResolvedValueOnce({ data: { user: { id: 'u3' }, session: null }, error: null });

      await expect(signUpWithEmail('a@b.com', 'secret1')).resolves.toEqual({ needsConfirmation: true });
    });

    it('reports no confirmation needed when sign-up returns a session', async () => {
      (supabase.auth.signUp as jest.Mock).mockResolvedValueOnce({
        data: { user: { id: 'u3' }, session: { access_token: 'x' } },
        error: null,
      });

      await expect(signUpWithEmail('a@b.com', 'secret1')).resolves.toEqual({ needsConfirmation: false });
    });

    it('returns quietly when the Google account picker is cancelled', async () => {
      (GoogleSignin.signIn as jest.Mock).mockResolvedValueOnce({ type: 'cancelled', data: null });

      await expect(signInWithGoogle()).resolves.toBeUndefined();

      expect(supabase.auth.signInWithIdToken).not.toHaveBeenCalled();
    });

    it('clears the onboarding draft on sign out so it cannot reach the next account', async () => {
      await saveDraft({ age: 30 }, 3);
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });

      await signOut();

      expect(await loadDraft()).toEqual({ draft: {}, step: 1 });
    });

    it('clears the onboarding draft when the account is deleted', async () => {
      await saveDraft({ age: 30 }, 3);
      (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({ data: { deleted: true }, error: null });
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });

      await deleteAccount();

      expect(await loadDraft()).toEqual({ draft: {}, step: 1 });
    });
  });

  describe('pending offline data', () => {
    const pendingSet = (id: string) =>
      ({ kind: 'workout_set', id, date: '2026-10-13', exerciseId: 'e', setNumber: 1, reps: 5, weightKg: 10, updatedAt: 1 }) as const;

    it('removes the deleted account pending data but not another account', async () => {
      await enqueue('u1', pendingSet('s1'));
      await enqueue('u2', pendingSet('s2'));
      (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } });
      (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({ data: { deleted: true }, error: null });
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });

      await deleteAccount();

      expect(await listPending('u1')).toEqual([]);
      expect(await listPending('u2')).toHaveLength(1);
    });

    it('removes the deleted account cached plan and profile, but not another account', async () => {
      await writeCache('u1', 'plan', { x: 1 });
      await writeCache('u1', 'profile', { y: 2 });
      await writeCache('u2', 'plan', { x: 3 });
      (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } });
      (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({ data: { deleted: true }, error: null });
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });

      await deleteAccount();

      expect(await readCache('u1', 'plan')).toBeNull();
      expect(await readCache('u1', 'profile')).toBeNull();
      expect(await readCache('u2', 'plan')).toEqual({ x: 3 });
    });

    it('removes the deleted account recent foods but not another account', async () => {
      const food = { id: 'f1', userId: null, name: 'Apple', aliases: {}, servingDesc: '1', calories: 52, proteinG: 0.3, carbsG: 14, fatG: 0.2, source: 'usda', verified: false, region: null, sourceId: null, barcode: null };
      await rememberFoods('u1', [food]);
      await rememberFoods('u2', [food]);
      (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } });
      (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({ data: { deleted: true }, error: null });
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });

      await deleteAccount();

      expect(await recentFoods('u1')).toEqual([]);
      expect(await recentFoods('u2')).toHaveLength(1);
    });

    it('still signs out locally if clearing local photos throws', async () => {
      (removeLocalPhotos as jest.Mock).mockImplementationOnce(() => {
        throw new Error('disk error');
      });
      (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } });
      (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({ data: { deleted: true }, error: null });
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });

      await deleteAccount();

      expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('removes the deleted account unsynced local photos', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } });
      (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({ data: { deleted: true }, error: null });
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });

      await deleteAccount();

      expect(removeLocalPhotos).toHaveBeenCalledWith('u1');
    });

    it('keeps pending data on sign out so offline entries sync after the next sign-in', async () => {
      await enqueue('u1', pendingSet('s1'));
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });

      await signOut();

      expect(await listPending('u1')).toHaveLength(1);
    });
  });

  describe('personal reminders', () => {
    beforeEach(() => (expoNotificationApi.cancel as jest.Mock).mockClear());
    const expectEveryReminderCancelled = () => {
      expect(expoNotificationApi.cancel).toHaveBeenCalledWith('rise120-reminder-2026-10-19T10:00:00.000Z');
      expect(expoNotificationApi.cancel).toHaveBeenCalledWith('rise120-reminder-2026-10-20T10:00:00.000Z');
      expect(expoNotificationApi.cancel).not.toHaveBeenCalledWith('other-feature');
    };

    it('are all cancelled on sign-out (every day in the window, nothing else), so the next person on this phone gets none', async () => {
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });

      await signOut();

      expectEveryReminderCancelled();
    });

    it('stay scheduled when sign-out itself fails, because the person is still signed in', async () => {
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: { message: 'Network error' } });

      await expect(signOut()).rejects.toThrow();

      expect(expoNotificationApi.cancel).not.toHaveBeenCalled();
    });

    it('are cancelled when the account is deleted', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } });
      (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({ error: null });
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });

      await deleteAccount();

      expectEveryReminderCancelled();
    });

    it('never block signing out when the device refuses to cancel', async () => {
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });
      (expoNotificationApi.cancel as jest.Mock).mockRejectedValueOnce(new Error('no'));

      await expect(signOut()).resolves.toBeUndefined();
    });
  });
});
