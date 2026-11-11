// Step 1 of the OTP flow (AKIBA-MOB-001 §2). Same account semantics as
// hub-page's web src/app/(auth)/login/page.tsx — a plain 6-digit email
// code, no magic link, shouldCreateUser: true so a first request is also
// the signup — with the spec's labelling, validation, error mapping and
// legal links added on top.
import { useEffect, useRef, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { track } from '@/analytics';
import { consumeSessionNotice, emailFieldError, mapAuthError, normalizeEmail, supabase } from '@/auth';
import { LegalLinksNotice } from '@/components/legal-links';
import { OnboardingScreen } from '@/components/onboarding/chrome';
import { hasSeenIntro } from '@/onboarding';
import { FormField, Text, TextButton, View, colors, fontFamily, spacing, typography } from '@/design-system';

export default function SignInScreen() {
  // A device that has never seen the intro slides goes there first. Read
  // once, synchronously, so the email form never flashes before redirecting.
  const [needsIntro] = useState(() => !hasSeenIntro());
  if (needsIntro) return <Redirect href="/intro" />;
  return <SignInForm />;
}

function SignInForm() {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // OTP stays the default and the promoted path (AKIBA-MOB-001 §2). Password
  // exists for members who set one in Settings, and so a store reviewer can
  // be given a durable credential instead of someone forwarding an expiring
  // code — which is what made review access a release blocker.
  const [mode, setMode] = useState<'otp' | 'password'>('otp');
  const [password, setPassword] = useState('');
  // Why the member is back here, when they were signed out rather than
  // arriving fresh. Read once on mount so it can't reappear later.
  const [notice] = useState(() => consumeSessionNotice());
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    track('sign_in_started');
  }, []);

  async function sendCode() {
    const invalid = emailFieldError(email);
    if (invalid) {
      // Validate before submitting so a typo costs nothing — Supabase's
      // email sends are rate-limited per address.
      setFieldError(invalid);
      return;
    }

    setFieldError(null);
    setFormError(null);
    setSending(true);

    const address = normalizeEmail(email);
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });
    setSending(false);

    if (error) {
      setFormError(mapAuthError(error, 'send'));
      return;
    }

    track('otp_sent');
    router.push({ pathname: '/verify', params: { email: address, sentAt: String(Date.now()) } });
  }

  async function signInWithPassword() {
    const invalid = emailFieldError(email);
    if (invalid) {
      setFieldError(invalid);
      return;
    }
    if (!password) {
      setFormError('Enter your password, or sign in with a code instead.');
      return;
    }

    setFieldError(null);
    setFormError(null);
    setSending(true);

    track('password_sign_in_submitted');
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizeEmail(email),
      password,
    });
    setSending(false);

    if (error) {
      // `reason` is the only detail carried: scrubProps allows it, and it is
      // a bounded Supabase code rather than anything the member typed.
      track('password_sign_in_failed', { reason: (error as { code?: string }).code ?? 'unknown' });
      setFormError(mapAuthError(error, 'password'));
      return;
    }

    track('password_sign_in_succeeded');
    // No navigation: the session lands via onAuthStateChange and
    // (auth)/_layout redirects to "/" once it exists.
  }

  function switchMode(next: 'otp' | 'password') {
    setMode(next);
    setFormError(null);
    setFieldError(null);
    // Never leave a typed password behind a mode switch.
    setPassword('');
  }


  return (
    <OnboardingScreen
      body={
        mode === 'otp'
          ? 'We’ll send you a 6-digit code. No password needed.'
          : 'Enter the email and password for your Akiba account.'
      }
      layout="form"
      mark
      onBack={router.canGoBack() ? () => router.back() : undefined}
      onPrimary={() => (mode === 'otp' ? void sendCode() : void signInWithPassword())}
      primaryBusy={sending}
      primaryBusyLabel={mode === 'otp' ? 'Sending code…' : 'Signing in…'}
      primaryLabel={mode === 'otp' ? 'Send code' : 'Sign in'}
      error={formError}
      secondary={
        <View style={styles.secondary}>
          <TextButton
            label={mode === 'otp' ? 'Use a password instead' : 'Use a 6-digit code instead'}
            onPress={() => switchMode(mode === 'otp' ? 'password' : 'otp')}
          />
          {/* Only the OTP path passes shouldCreateUser, so the
              account-creation sentence would be false in password mode. */}
          <LegalLinksNotice
            intro={
              mode === 'otp'
                ? 'By continuing, you agree to the Akiba Terms of Use and Privacy Policy. We’ll create your account the first time you sign in.'
                : 'By continuing, you agree to the Akiba Terms of Use and Privacy Policy.'
            }
          />
        </View>
      }
      title={mode === 'otp' ? 'What’s your email?' : 'Welcome back'}>
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {notice}
        </Text>
      ) : null}

      <FormField
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        autoFocus
        error={fieldError}
        inputMode="email"
        keyboardType="email-address"
        label="Email address"
        onChangeText={(value) => {
          setEmail(value);
          if (fieldError) setFieldError(null);
          if (formError) setFormError(null);
        }}
        onSubmitEditing={() => (mode === 'otp' ? void sendCode() : void signInWithPassword())}
        placeholder="you@example.com"
        returnKeyType={mode === 'otp' ? 'send' : 'next'}
        style={styles.input}
        textContentType="emailAddress"
        value={email}
      />

      {mode === 'password' ? (
        <FormField
          autoCapitalize="none"
          autoComplete="current-password"
          autoCorrect={false}
          label="Password"
          onChangeText={(value) => {
            setPassword(value);
            if (formError) setFormError(null);
          }}
          onSubmitEditing={() => void signInWithPassword()}
          placeholder="Your password"
          returnKeyType="go"
          secureTextEntry
          style={styles.input}
          textContentType="password"
          value={password}
        />
      ) : null}
    </OnboardingScreen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderRadius: 14,
    minHeight: 56,
  },
  secondary: {
    gap: spacing.xs,
  },
  notice: {
    backgroundColor: colors.tint,
    borderCurve: 'continuous',
    borderRadius: 12,
    color: colors.ink,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.small,
    lineHeight: 21,
    padding: spacing.md,
  },
});
