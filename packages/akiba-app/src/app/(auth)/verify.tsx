// Step 2 of the OTP flow (AKIBA-MOB-001 §2). Verification uses the same
// call as hub-page's web login — verifyOtp({ email, token, type: 'email' }),
// which covers both new and returning users. On success there is nothing to
// navigate manually: AuthProvider's onAuthStateChange updates `session`, and
// the route-group guards take it from there.
import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Platform, StyleSheet, TextInput } from 'react-native';

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
import { OnboardingScreen } from '@/components/onboarding/chrome';
import { Text, TextButton, View, colors, fontFamily, spacing, typography } from '@/design-system';

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
  // After a wrong code, Verify stays off until the member changes it —
  // resubmitting the same six digits can only fail the same way. Typing
  // clears the error, which re-enables it.
  const rejected = !!fieldError && code.length === CODE_LENGTH;

  return (
    <OnboardingScreen
      body={
        <>
          {'Sent to '}
          <Text style={styles.email}>{email}</Text>
        </>
      }
      layout="form"
      onBack={() => router.back()}
      onPrimary={() => void verify(code)}
      primaryBusy={verifying}
      primaryBusyLabel="Verifying…"
      primaryDisabled={code.length !== CODE_LENGTH || rejected}
      primaryLabel="Verify"
      title="Enter your code">
      <View style={styles.changeRow}>
        <TextButton
          accessibilityHint="Goes back to sign in with a different email address"
          label="Change email"
          onPress={() => router.back()}
        />
      </View>

      <View style={styles.codeBlock}>
        <CodeBoxes code={code} invalid={!!fieldError} />
        {/* One real input laid over the boxes: it is what the keyboard,
            iOS "From Mail" / Android SMS autofill and screen readers talk
            to. The boxes are only a picture of its value. */}
        <TextInput
          accessibilityHint={`Enter the ${CODE_LENGTH}-digit code from your email`}
          accessibilityLabel="Verification code"
          aria-invalid={!!fieldError}
          autoComplete={Platform.OS === 'ios' ? 'one-time-code' : 'sms-otp'}
          autoFocus
          caretHidden
          inputMode="numeric"
          keyboardType="number-pad"
          maxLength={CODE_LENGTH}
          onChangeText={(value) => {
            setCode(toVerificationCode(value));
            if (fieldError) setFieldError(null);
          }}
          selectionColor="transparent"
          style={styles.hiddenInput}
          textContentType="oneTimeCode"
          value={code}
        />
      </View>

      <View style={styles.status}>
        {fieldError ? (
          <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
            {fieldError}
          </Text>
        ) : null}
        {notice ? (
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {notice}
          </Text>
        ) : null}
        {canResend ? (
          <TextButton
            accessibilityHint="Sends a new code to the same address"
            label="Resend code"
            onPress={() => void resend()}
          />
        ) : (
          <Text style={styles.countdown}>
            {resending ? 'Sending…' : `Resend code in ${formatCountdown(secondsLeft)}`}
          </Text>
        )}
        {fieldError ? <Text style={styles.spam}>Didn’t get it? Check your spam folder.</Text> : null}
      </View>
    </OnboardingScreen>
  );
}

function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function CodeBoxes({ code, invalid }: { code: string; invalid: boolean }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.boxes}>
      {Array.from({ length: CODE_LENGTH }, (_, index) => {
        const digit = code[index];
        const active = !invalid && index === code.length;
        return (
          <View key={index} style={[styles.box, active && styles.boxActive, invalid && styles.boxInvalid]}>
            <Text style={styles.digit}>{digit ?? ''}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  email: {
    color: colors.ink,
    fontFamily: fontFamily.sansSemiBold,
  },
  changeRow: {
    alignItems: 'center',
    marginTop: -spacing.xl,
  },
  codeBlock: {
    justifyContent: 'center',
  },
  boxes: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  box: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderCurve: 'continuous',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    height: 56,
    justifyContent: 'center',
    maxWidth: 52,
  },
  boxActive: {
    borderColor: colors.teal,
    borderWidth: 2,
  },
  boxInvalid: {
    borderColor: colors.danger,
    borderWidth: 2,
  },
  digit: {
    color: colors.ink,
    fontFamily: fontFamily.sansBold,
    fontSize: typography.title,
  },
  hiddenInput: {
    ...StyleSheet.absoluteFill,
    color: 'transparent',
    opacity: 0.02,
  },
  status: {
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: -spacing.md,
  },
  error: {
    color: colors.danger,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.small,
    textAlign: 'center',
  },
  notice: {
    color: colors.tealDark,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.small,
    textAlign: 'center',
  },
  countdown: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.small,
    paddingVertical: spacing.md,
  },
  spam: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.small,
    textAlign: 'center',
  },
});
