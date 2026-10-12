import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { t } from '../../src/i18n';
import { tokens } from '../../src/theme/tokens';
import { signUpWithEmail, signInWithGoogle } from '../../src/auth/authService';

export default function SignUpScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSignUp = async () => {
    if (!email || !password) return;
    try {
      setLoading(true);
      setErrorMessage(null);
      await signUpWithEmail(email.trim(), password);
    } catch (err: any) {
      setErrorMessage(err?.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      await signInWithGoogle();
    } catch (err: any) {
      setErrorMessage(err?.message || t('errors.generic'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('welcome.title')}</Text>
      <Text style={styles.subtitle}>{t('auth.signUp')}</Text>

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      <TextInput
        style={styles.input}
        placeholder={t('auth.email')}
        placeholderTextColor="#8892A0"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <TextInput
        style={styles.input}
        placeholder={t('auth.password')}
        placeholderTextColor="#8892A0"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity
        style={[styles.button, styles.primaryButton]}
        onPress={handleSignUp}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#101318" />
        ) : (
          <Text style={styles.primaryButtonText}>{t('auth.signUp')}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.secondaryButton]}
        onPress={handleGoogleSignIn}
        disabled={loading}
      >
        <Text style={styles.secondaryButtonText}>{t('auth.google')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
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
    color: '#8892A0',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: tokens.space[5],
  },
  errorText: {
    color: '#FF6B6B',
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
    borderColor: '#2D3748',
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
