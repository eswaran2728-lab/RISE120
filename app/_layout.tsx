import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import '../src/i18n';
import { tokens } from '../src/theme/tokens';
import { useSession } from '../src/auth/useSession';
import { supabase } from '../src/lib/supabase';

export default function RootLayout() {
  const { session, loading } = useSession();
  const [profileLoading, setProfileLoading] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
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
      try {
        const { data } = await supabase
          .from('profiles')
          .select('onboarded_at')
          .eq('id', session.user.id)
          .single();
        if (isMounted) {
          setOnboarded(Boolean(data?.onboarded_at));
        }
      } catch {
        if (isMounted) {
          setOnboarded(false);
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
  }, [session?.user?.id]);

  const effectiveOnboarded = session ? onboarded : null;
  const effectiveProfileLoading = session ? profileLoading : false;

  useEffect(() => {
    if (loading || effectiveProfileLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!session) {
      if (!inAuthGroup) {
        router.replace('/(auth)/sign-in');
      }
    } else {
      if (effectiveOnboarded === false) {
        if (segments[0] !== 'onboarding') {
          router.replace('/onboarding/1' as any);
        }
      } else if (effectiveOnboarded === true) {
        if (inAuthGroup || segments[0] !== '(tabs)') {
          router.replace('/(tabs)/today' as any);
        }
      }
    }
  }, [session, loading, effectiveProfileLoading, effectiveOnboarded, segments, router]);

  if (loading || effectiveProfileLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={tokens.color.accent} size="large" />
      </View>
    );
  }

  return (
    <ThemeProvider value={DarkTheme}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
