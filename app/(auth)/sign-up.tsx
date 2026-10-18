import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { t } from '../../src/i18n';
import { authErrorKey } from '../../src/auth/authErrors';
import { tokens } from '../../src/theme/tokens';
import { signUpWithEmail, signInWithGoogle } from '../../src/auth/authService';

export default function SignUpScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleSignUp = async () => {
    if (!email || !password) return;
    try {
      setLoading(true);
      setErrorMessage(null);
      setInfoMessage(null);
      const { needsConfirmation } = await signUpWithEmail(email.trim(), password);
      if (needsConfirmation) setInfoMessage(t('auth.checkEmail'));
    } catch (err: unknown) {
      setErrorMessage(t(authErrorKey(err)));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      await signInWithGoogle();
    } catch (err: unknown) {
      setErrorMessage(t(authErrorKey(err)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('welcome.title')}</Text>
      <Text style={styles.subtitle}>{t('auth.signUp')}</Text>

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
      {infoMessage ? <Text style={styles.infoText}>{infoMessage}</Text> : null}

      <TextInput accessibilityLabel={t('auth.email')}
        style={styles.input}
        placeholder={t('auth.email')}
        placeholderTextColor={tokens.color.textSecondary}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <TextInput accessibilityLabel={t('auth.password')}
        style={styles.input}
        placeholder={t('auth.password')}
        placeholderTextColor={tokens.color.textSecondary}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity accessibilityRole="button"
        style={[styles.button, styles.primaryButton]}
        onPress={handleSignUp}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={tokens.color.onAccent} />
        ) : (
          <Text style={styles.primaryButtonText}>{t('auth.signUp')}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity accessibilityRole="button"
        style={[styles.button, styles.secondaryButton]}
        onPress={handleGoogleSignIn}
        disabled={loading}
      >
        <Text style={styles.secondaryButtonText}>{t('auth.google')}</Text>
      </TouchableOpacity>

      <TouchableOpacity accessibilityRole="button"
        style={styles.linkButton}
        onPress={() => router.push('/(auth)/sign-in')}
      >
        <Text style={styles.linkText}>{t('auth.signIn')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.color.bg,
    paddingHorizontal: tokens.space[5],
    justifyContent: 'center',
  },
  title: {
    color: tokens.color.text,
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: tokens.space[2],
  },
  subtitle: {
    color: tokens.color.textSecondary,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: tokens.space[5],
  },
  infoText: {
    color: tokens.color.accent,
    textAlign: 'center',
    marginBottom: tokens.space[3],
  },
  errorText: {
    color: tokens.color.danger,
    textAlign: 'center',
    marginBottom: tokens.space[3],
  },
  input: {
    backgroundColor: tokens.color.surface,
    color: tokens.color.text,
    borderRadius: 8,
    paddingHorizontal: tokens.space[4],
    minHeight: tokens.minTap,
    marginBottom: tokens.space[3],
    fontSize: 16,
  },
  button: {
    minHeight: tokens.minTap,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: tokens.space[3],
    paddingHorizontal: tokens.space[4],
  },
  primaryButton: {
    backgroundColor: tokens.color.accent,
  },
  primaryButtonText: {
    color: tokens.color.bg,
    fontWeight: '600',
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.borderStrong,
  },
  secondaryButtonText: {
    color: tokens.color.text,
    fontSize: 16,
  },
  linkButton: {
    minHeight: tokens.minTap,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: tokens.space[2],
  },
  linkText: {
    color: tokens.color.accent,
    fontSize: 16,
  },
});
