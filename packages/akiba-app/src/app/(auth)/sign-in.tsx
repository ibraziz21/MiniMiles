// Mirrors hub-page's src/app/(auth)/login/page.tsx OTP step: plain 6-digit
// email code, no magic link, shouldCreateUser: true (self-serve signup on
// first request — same account-creation semantics as web).
import { useState } from 'react';
import { router } from 'expo-router';

import { Button, Card, ScrollView, StyleSheet, Text, TextInput, View, colors, spacing, typography } from '@/design-system';
import { supabase } from '@/auth';

type ScreenState = { status: 'idle' | 'sending' } | { status: 'error'; message: string };

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [state, setState] = useState<ScreenState>({ status: 'idle' });

  async function sendCode() {
    setState({ status: 'sending' });
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }
    setSent(true);
    setState({ status: 'idle' });
    router.push({ pathname: '/verify', params: { email: email.trim() } });
  }

  const canSubmit = email.trim().length > 3 && state.status !== 'sending';

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.scrollContent}
      style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>AKIBA PASS</Text>
        <Card style={styles.card}>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.body}>Enter your email and we&apos;ll send you a 6-digit code.</Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            style={styles.input}
          />

          {state.status === 'error' ? <Text style={styles.error}>{state.message}</Text> : null}

          <Button onPress={sendCode} disabled={!canSubmit} style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}>
            <Text style={styles.submitLabel}>{state.status === 'sending' ? 'Sending…' : sent ? 'Resend code' : 'Send code'}</Text>
          </Button>
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.paper,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  content: {
    alignSelf: 'center',
    gap: spacing.md,
    maxWidth: 520,
    width: '100%',
  },
  eyebrow: {
    color: colors.teal,
    fontSize: typography.caption,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  card: {
    gap: spacing.md,
  },
  title: {
    color: colors.ink,
    fontSize: typography.title,
    fontWeight: '700',
  },
  body: {
    color: colors.muted,
    fontSize: typography.body,
  },
  input: {
    borderColor: colors.line,
    borderCurve: 'continuous',
    borderRadius: 12,
    borderWidth: 1,
    color: colors.ink,
    fontSize: typography.body,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  error: {
    color: '#C0392B',
    fontSize: typography.caption,
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: colors.teal,
    borderRadius: 999,
    paddingVertical: spacing.sm,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitLabel: {
    color: colors.white,
    fontSize: typography.body,
    fontWeight: '700',
  },
});
