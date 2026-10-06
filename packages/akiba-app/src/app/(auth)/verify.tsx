// Mirrors hub-page's src/app/(auth)/login/page.tsx verify step:
// supabase.auth.verifyOtp({ email, token, type: "email" }) — the same
// `type` is used for both new and returning users. On success there is
// nothing to navigate manually: AuthProvider's onAuthStateChange updates
// `session`, and the (tabs)/(auth) layout guards redirect automatically.
import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { Button, Card, ScrollView, StyleSheet, Text, TextInput, View, colors, spacing, typography } from '@/design-system';
import { supabase } from '@/auth';

type ScreenState = { status: 'idle' | 'verifying' | 'resending' } | { status: 'error'; message: string };

export default function VerifyScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  const [state, setState] = useState<ScreenState>({ status: 'idle' });

  async function verify() {
    setState({ status: 'verifying' });
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' });
    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }
    // Session change propagates via onAuthStateChange — no manual navigation.
  }

  async function resend() {
    setState({ status: 'resending' });
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    setState(error ? { status: 'error', message: error.message } : { status: 'idle' });
  }

  const canSubmit = code.trim().length === 6 && state.status !== 'verifying';

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.scrollContent}
      style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>AKIBA PASS</Text>
        <Card style={styles.card}>
          <Text style={styles.title}>Enter your code</Text>
          <Text style={styles.body}>We sent a 6-digit code to {email}.</Text>

          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            maxLength={6}
            style={styles.input}
          />

          {state.status === 'error' ? <Text style={styles.error}>{state.message}</Text> : null}

          <Button onPress={verify} disabled={!canSubmit} style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}>
            <Text style={styles.submitLabel}>{state.status === 'verifying' ? 'Verifying…' : 'Verify'}</Text>
          </Button>

          <Button onPress={resend} disabled={state.status === 'resending'} style={styles.resendButton}>
            <Text style={styles.resendLabel}>{state.status === 'resending' ? 'Sending…' : 'Resend code'}</Text>
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
    fontSize: typography.title,
    letterSpacing: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: 'center',
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
  resendButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  resendLabel: {
    color: colors.teal,
    fontSize: typography.caption,
    fontWeight: '600',
  },
});
