// Step 2 of the OTP flow (AKIBA-MOB-001 §2). Verification uses the same
// call as hub-page's web login — verifyOtp({ email, token, type: 'email' }),
// which covers both new and returning users. On success there is nothing to
// navigate manually: AuthProvider's onAuthStateChange updates `session`, and
// the route-group guards take it from there.
import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { track } from '@/analytics';
import {
  CODE_LENGTH,
  mapAuthError,
  parseCooldownSeconds,
  RESEND_COOLDOWN_MS,
  resendDeadline,
  supabase,
  toVerificationCode,
  useResendCountdown,
} from '@/auth';
import {
  Card,
  FormField,
  PrimaryButton,
  ScrollView,
  Text,
  TextButton,
  View,
  colors,
  fontFamily,
  spacing,
  typography,
} from '@/design-system';

export default function VerifyScreen() {
  const params = useLocalSearchParams<{ email: string; sentAt?: string }>();
  const email = params.email ?? '';

  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendAt, setResendAt] = useState(() => resendDeadline(params.sentAt));

  // Autofill fires onChangeText with all six digits at once, so the screen
  // submits for the member rather than making them reach for the button.
  // The ref makes that at-most-once per distinct code, so a failed attempt
  // can't loop.
  const attempted = useRef<string | null>(null);
  const secondsLeft = useResendCountdown(resendAt);

  async function verify(submitted: string) {
    if (verifying || submitted.length !== CODE_LENGTH) return;
    attempted.current = submitted;
    setFieldError(null);
    setNotice(null);
    setVerifying(true);

    const { error } = await supabase.auth.verifyOtp({ email, token: submitted, type: 'email' });

    if (error) {
      setVerifying(false);
      setFieldError(mapAuthError(error, 'verify'));
      return;
    }

    track('otp_verified');
    // Leave `verifying` set: the session change unmounts this screen, and
    // clearing it would briefly re-enable the button underneath.
  }

  useEffect(() => {
    if (code.length === CODE_LENGTH && attempted.current !== code) {
      void verify(code);
    }
    // `verify` is stable enough for this guard — re-running it on every
    // render would defeat the attempted-code ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function resend() {
    setResending(true);
    setFieldError(null);
    setNotice(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    setResending(false);

    if (error) {
      // When Supabase names its own cooldown, honour that instead of the
      // local 30s — otherwise the button would re-enable before the server
      // will accept another send.
      const cooldown = parseCooldownSeconds(error);
      if (cooldown !== null) setResendAt(Date.now() + cooldown * 1000);
      setFieldError(mapAuthError(error, 'send'));
      return;
    }

    attempted.current = null;
    setCode('');
    setResendAt(Date.now() + RESEND_COOLDOWN_MS);
    setNotice(`We sent a new code to ${email}.`);
    track('otp_sent');
  }

  const canResend = secondsLeft === 0 && !resending && !verifying;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.shell}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.shell}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          style={styles.scroll}>
          <View style={styles.content}>
            <Text accessibilityRole="header" style={styles.eyebrow}>
              AKIBA PASS
            </Text>

            <Card style={styles.card}>
              <Text accessibilityRole="header" style={styles.title}>
                Enter your code
              </Text>

              <View style={styles.sentTo}>
                <Text style={styles.label}>Email</Text>
                <Text style={styles.email}>{email}</Text>
                <Text style={styles.body}>
                  We sent a {CODE_LENGTH}-digit code. It can take a minute to arrive — check your spam folder
                  if you don’t see it.
                </Text>
              </View>

              <FormField
                autoComplete={Platform.OS === 'ios' ? 'one-time-code' : 'sms-otp'}
                autoFocus
                error={fieldError}
                inputMode="numeric"
                keyboardType="number-pad"
                label="Verification code"
                onChangeText={(value) => {
                  setCode(toVerificationCode(value));
                  if (fieldError) setFieldError(null);
                }}
                placeholder="123456"
                style={styles.codeInput}
                textContentType="oneTimeCode"
                value={code}
              />

              {notice ? (
                <Text accessibilityLiveRegion="polite" style={styles.notice}>
                  {notice}
                </Text>
              ) : null}

              <PrimaryButton
                busy={verifying}
                busyLabel="Verifying…"
                disabled={code.length !== CODE_LENGTH}
                label="Verify"
                onPress={() => void verify(code)}
              />

              <View style={styles.actions}>
                <TextButton
                  accessibilityHint={
                    canResend ? 'Sends a new code to the same address' : `Available in ${secondsLeft} seconds`
                  }
                  disabled={!canResend}
                  label={
                    resending ? 'Sending…' : secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'
                  }
                  onPress={() => void resend()}
                />
                <TextButton
                  accessibilityHint="Goes back to sign in with a different email address"
                  label="Change email"
                  onPress={() => router.back()}
                  tone="muted"
                />
              </View>
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.paper,
    flex: 1,
  },
  scroll: {
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
    color: colors.tealDark,
    fontFamily: fontFamily.sansBold,
    fontSize: typography.caption,
    letterSpacing: 1.5,
  },
  card: {
    gap: spacing.lg,
  },
  title: {
    color: colors.ink,
    fontFamily: fontFamily.sterlingSemiBold,
    fontSize: typography.title,
  },
  sentTo: {
    gap: spacing.xs,
    marginTop: -spacing.sm,
  },
  label: {
    color: colors.ink,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: typography.small,
  },
  email: {
    color: colors.ink,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.body,
  },
  body: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.small,
    lineHeight: 21,
  },
  codeInput: {
    fontFamily: fontFamily.sansBold,
    fontSize: typography.title,
    letterSpacing: 8,
    textAlign: 'center',
  },
  notice: {
    color: colors.tealDark,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.small,
  },
  actions: {
    alignItems: 'center',
    gap: spacing.xs,
  },
});
