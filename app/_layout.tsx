import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { t } from '../src/i18n';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { supabase } from '../src/lib/supabase';

export default function RootLayout() {
  const { session, loading } = useSession();
  const [profileLoading, setProfileLoading] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
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
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('onboarded_at')
          .eq('id', session.user.id)
          .single();
        if (error) throw error;
        if (isMounted) {
          setOnboarded(Boolean(data?.onboarded_at));
        }
      } catch {
        if (isMounted) {
          setProfileError(true);
        }
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

  const effectiveOnboarded = session ? onboarded : null;
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
      } else if (effectiveOnboarded === true) {
        if (inAuthGroup || topSegment !== '(tabs)') {
          router.replace('/(tabs)/today' as any);
        }
      }
    }
  }, [session, loading, effectiveProfileLoading, profileError, effectiveOnboarded, segments, router]);

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
      </View>
    );
  }

  return (
    <ThemeProvider value={DarkTheme}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
