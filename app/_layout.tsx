import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import i18next, { t } from '../src/i18n';
import { signOut } from '../src/auth/authService';
import { useSync } from '../src/sync/useSync';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { supabase } from '../src/lib/supabase';
import { onOnboardingComplete, onPlanInputsSaved } from '../src/onboarding/completion';
import { cacheUnits, loadProfileCache, ProfileCache, saveProfileCache, updateProfileCache } from '../src/profile/cache';

// Screens an onboarded user may be on; anywhere else (auth, onboarding) goes to Today.
const SIGNED_IN_SEGMENTS = ['(tabs)', 'settings', 'plan-preview', 'checkin', 'food-edit', 'food-search', 'food-scan'];

export default function RootLayout() {
  const { session, loading } = useSession();
  const [profileLoading, setProfileLoading] = useState(false);
  const [onboarded, setOnboarded] = useState<{ userId: string; value: boolean; needsPlanInputs: boolean } | null>(null);
  const [profileError, setProfileError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;
    if (!session?.user?.id) {
      return;
    }

    Promise.resolve().then(async () => {
      if (!isMounted) return;
      setProfileLoading(true);
      setProfileError(false);
      const uid = session.user.id;
      const apply = (profile: ProfileCache) => {
        if (profile.language && ['en', 'ms', 'ta'].includes(profile.language)) {
          void i18next.changeLanguage(profile.language);
        }
        if (isMounted) {
          setOnboarded({ userId: uid, value: profile.onboarded, needsPlanInputs: profile.needsPlanInputs });
        }
      };
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('onboarded_at, language, energy_sex, activity_level, units')
          .eq('id', uid)
          .maybeSingle();
        if (error) throw error;
        const profile: ProfileCache = {
          onboarded: Boolean(data?.onboarded_at),
          needsPlanInputs: !data?.energy_sex || !data?.activity_level,
          language: data?.language ?? null,
        };
        await saveProfileCache(uid, profile);
        await cacheUnits(uid, data?.units === 'imperial' ? 'imperial' : 'metric');
        apply(profile);
      } catch {
        // Offline cold start: use what we last knew about this account instead of blocking the app.
        const cached = await loadProfileCache(uid);
        if (cached) apply(cached);
        else if (isMounted) setProfileError(true);
      } finally {
        if (isMounted) {
          setProfileLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [session?.user?.id, attempt]);

  const userId = session?.user?.id;
  useSync(userId);
  useEffect(
    () =>
      onOnboardingComplete(() => {
        if (!userId) return;
        setOnboarded({ userId, value: true, needsPlanInputs: false });
        void updateProfileCache(userId, { onboarded: true });
      }),
    [userId]
  );
  useEffect(
    () =>
      onPlanInputsSaved(() => {
        setOnboarded((current) => (current ? { ...current, needsPlanInputs: false } : current));
        if (userId) void updateProfileCache(userId, { needsPlanInputs: false });
      }),
    [userId]
  );

  // The flag only counts for the user it was loaded for, so it cannot leak between accounts.
  const effectiveOnboarded = session && onboarded?.userId === session.user.id ? onboarded.value : null;
  const needsPlanInputs = session && onboarded?.userId === session.user.id ? onboarded.needsPlanInputs : false;
  const effectiveProfileLoading = session ? profileLoading : false;

  useEffect(() => {
    if (loading || effectiveProfileLoading || (session && profileError)) return;

    // Typed routes only list existing screens; widen so we can compare against upcoming ones.
    const topSegment: string | undefined = segments[0];
    const inAuthGroup = topSegment === '(auth)';

    if (!session) {
      if (!inAuthGroup) {
        router.replace('/(auth)/sign-in');
      }
    } else {
      if (effectiveOnboarded === false) {
        if (topSegment !== 'onboarding') {
          router.replace('/onboarding/1' as any);
        }
      } else if (effectiveOnboarded === true && needsPlanInputs) {
        if (topSegment !== 'plan-inputs') {
          router.replace('/plan-inputs' as any);
        }
      } else if (effectiveOnboarded === true) {
        if (inAuthGroup || !SIGNED_IN_SEGMENTS.includes(topSegment ?? '')) {
          router.replace('/(tabs)/today' as any);
        }
      }
    }
  }, [session, loading, effectiveProfileLoading, profileError, effectiveOnboarded, needsPlanInputs, segments, router]);

  if (loading || effectiveProfileLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={tokens.color.accent} size="large" />
      </View>
    );
  }

  if (session && profileError) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: tokens.color.text }}>{t('errors.generic')}</Text>
        <Pressable testID="profile-retry" accessibilityRole="button" onPress={() => setAttempt((n) => n + 1)}>
          <Text style={{ color: tokens.color.accent }}>{t('errors.retry')}</Text>
        </Pressable>
        <Pressable testID="profile-signout" accessibilityRole="button" onPress={() => void signOut()}>
          <Text style={{ color: tokens.color.text }}>{t('settings.signOut')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ThemeProvider value={DarkTheme}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
