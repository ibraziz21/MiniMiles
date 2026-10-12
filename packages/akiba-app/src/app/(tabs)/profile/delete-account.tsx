// Account deletion (AKIBA-MOB-002 §5.2–§5.6).
//
// A full screen, not an alert (§4.3): the member has to be able to read what
// they lose, what Akiba keeps, and what the blockchain keeps, before any
// destructive action is reachable. The irreversible tap is protected by an
// email code and one explicit acknowledgement — no typed confirmation word,
// which adds effort without proving identity.
//
// The four steps live in this one screen rather than four routes so a
// backgrounded app returns to exactly where it was with its entered context
// intact (§5.3, §15.2), instead of unwinding a navigation stack.
import { useCallback, useEffect, useRef, useState } from 'react';
import { router, Stack } from 'expo-router';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

import { createApiClient } from '@/api';
import { track } from '@/analytics';
import {
  CODE_LENGTH,
  isCompleteCode,
  RESEND_COOLDOWN_MS,
  setSessionNotice,
  toVerificationCode,
  useAuth,
  useResendCountdown,
} from '@/auth';
import { resolveDeletionError, previousStep, type DeletionStep } from '@/account-deletion';
import { useAppConfig } from '@/config';
import type { AccountDeletionSummary } from '@/contracts';
import { clearOnboardingStep } from '@/onboarding';
import { useMember } from '@/member';
import {
  ActivityIndicator,
  Button,
  FormField,
  Icon,
  PrimaryButton,
  ScrollView,
  Text,
  TextButton,
  View,
  colors,
  fontFamily,
  radius,
  spacing,
  typography,
} from '@/design-system';

type SummaryState =
  | { status: 'loading' }
  | { status: 'error'; message: string; retryable: boolean }
  | { status: 'ready'; data: AccountDeletionSummary };

export default function DeleteAccountScreen() {
  const { accessToken, signOut } = useAuth();
  const { legal } = useAppConfig();
  const { state: memberState } = useMember();

  const [summary, setSummary] = useState<SummaryState>({ status: 'loading' });
  const [step, setStep] = useState<DeletionStep>('review');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(() => Date.now());
  const [code, setCode] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opened = useRef(false);
  const secondsLeft = useResendCountdown(resendAt);

  const loadSummary = useCallback(async () => {
    setSummary({ status: 'loading' });
    try {
      const data = await createApiClient({ accessToken }).getAccountDeletionSummary();
      setSummary({ status: 'ready', data });
      setMaskedEmail(data.maskedEmail);
    } catch (caught) {
      const resolution = resolveDeletionError(caught);
      if (resolution.signOut) {
        setSessionNotice(
          resolution.errorCode === 'ACCOUNT_DELETION_PENDING' ? 'account_deletion_pending' : 'session_expired',
        );
        await signOut();
        return;
      }
      setSummary({ status: 'error', message: resolution.message, retryable: resolution.retryable });
    }
  }, [accessToken, signOut]);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    track('account_deletion_opened', { platform: Platform.OS });
    // Always a fresh projection (§5.2) — balances and voucher counts are
    // never carried in through navigation params.
    void loadSummary();
  }, [loadSummary]);

  // §13: the step change itself must reach a screen reader, not only the
  // newly rendered text.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(STEP_ANNOUNCEMENT[step]);
  }, [step]);

  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  const requestChallenge = useCallback(
    async (reason: 'start' | 'resend') => {
      setBusy(true);
      setError(null);
      try {
        const challenge = await createApiClient({ accessToken }).requestAccountDeletionChallenge();
        setChallengeId(challenge.challengeId);
        setMaskedEmail(challenge.maskedEmail);
        const available = Date.parse(challenge.resendAvailableAt);
        setResendAt(Number.isFinite(available) ? available : Date.now() + RESEND_COOLDOWN_MS);
        if (reason === 'resend') setCode('');
        setStep('verify');
        track('account_deletion_challenge_requested', { platform: Platform.OS, reason });
      } catch (caught) {
        const resolution = resolveDeletionError(caught);
        if (resolution.signOut) {
          setSessionNotice(
            resolution.errorCode === 'ACCOUNT_DELETION_PENDING' ? 'account_deletion_pending' : 'session_expired',
          );
          await signOut();
          return;
        }
        setError(resolution.message);
        if (resolution.returnTo) setStep(resolution.returnTo);
        track('account_deletion_request_failed', {
          platform: Platform.OS,
          step: 'challenge',
          errorCode: resolution.errorCode,
        });
      } finally {
        setBusy(false);
      }
    },
    [accessToken, signOut],
  );

  const submit = useCallback(async () => {
    if (!challengeId || !acknowledged || busy) return;

    setBusy(true);
    setError(null);
    track('account_deletion_confirmed', { platform: Platform.OS });

    try {
      const receipt = await createApiClient({ accessToken }).submitAccountDeletionRequest({
        challengeId,
        otp: code,
        policyVersion: legal.deletionPolicyVersion,
      });

      track('account_deletion_request_accepted', {
        platform: Platform.OS,
        already_requested: receipt.alreadyRequested,
      });

      // The receipt lives on an unguarded route so it survives the sign-out
      // that immediately follows (§5.5). Only the opaque reference and the
      // target date travel — no email, balance, or token.
      if (memberState.status === 'ready') {
        await clearOnboardingStep(memberState.bootstrap.user.id);
      }
      router.replace({
        pathname: '/account-deleted',
        params: {
          reference: receipt.requestId,
          targetCompletionAt: receipt.targetCompletionAt,
          alreadyRequested: receipt.alreadyRequested ? '1' : '0',
        },
      });
    } catch (caught) {
      const resolution = resolveDeletionError(caught);
      track('account_deletion_request_failed', {
        platform: Platform.OS,
        step: 'submit',
        errorCode: resolution.errorCode,
      });

      if (resolution.returnTo === 'verify') {
        track('account_deletion_verification_failed', {
          platform: Platform.OS,
          errorCode: resolution.errorCode,
        });
      }

      if (resolution.signOut) {
        setSessionNotice(
          resolution.errorCode === 'ACCOUNT_DELETION_PENDING' ? 'account_deletion_pending' : 'session_expired',
        );
        await signOut();
        return;
      }

      setError(resolution.message);
      if (resolution.returnTo) {
        setStep(resolution.returnTo);
        // The whole attempt is void at `review`; keeping a dead code in the
        // field would only produce a second confusing failure.
        if (resolution.returnTo === 'review') {
          setChallengeId(null);
          setCode('');
          setAcknowledged(false);
        }
      }
      setBusy(false);
    }
  }, [accessToken, acknowledged, busy, challengeId, code, legal.deletionPolicyVersion, memberState, signOut]);

  const goBack = useCallback(() => {
    const target = previousStep(step);
    setError(null);
    if (target) {
      setStep(target);
      return;
    }
    router.back();
  }, [step]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.shell}>
        <ScrollView
          contentContainerStyle={styles.page}
          keyboardShouldPersistTaps="handled"
          style={styles.screen}>
          <Button
            accessibilityHint="Returns to settings without deleting anything"
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={goBack}
            style={styles.back}>
            <Icon color={colors.muted} name="arrow-left" size={16} />
            <Text style={styles.backText}>{step === 'review' ? 'Back to settings' : 'Back'}</Text>
          </Button>

          <Text accessibilityRole="header" style={styles.title}>
            Delete account
          </Text>

          {summary.status === 'loading' ? (
            <View style={styles.centered}>
              <ActivityIndicator accessibilityLabel="Loading your account details" color={colors.teal} />
            </View>
          ) : summary.status === 'error' ? (
            <View style={styles.centered}>
              <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.errorText}>
                {summary.message}
              </Text>
              <PrimaryButton label="Try again" onPress={() => void loadSummary()} style={styles.retry} />
            </View>
          ) : (
            <>
              {step === 'review' ? (
                <ReviewStep
                  busy={busy}
                  onContinue={() => void requestChallenge('start')}
                  onKeep={() => router.back()}
                  summary={summary.data}
                />
              ) : null}

              {step === 'verify' ? (
                <VerifyStep
                  busy={busy}
                  code={code}
                  maskedEmail={maskedEmail}
                  onChangeCode={(value) => {
                    setCode(toVerificationCode(value));
                    if (error) setError(null);
                  }}
                  onContinue={() => setStep('confirm')}
                  onResend={() => void requestChallenge('resend')}
                  secondsLeft={secondsLeft}
                />
              ) : null}

              {step === 'confirm' ? (
                <ConfirmStep
                  acknowledged={acknowledged}
                  busy={busy}
                  onAcknowledge={() => setAcknowledged((current) => !current)}
                  onBack={goBack}
                  onDelete={() => void submit()}
                  summary={summary.data}
                />
              ) : null}

              {error ? (
                <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.errorBanner}>
                  {error}
                </Text>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const STEP_ANNOUNCEMENT: Record<DeletionStep, string> = {
  review: 'Delete account. Review what deleting your account removes.',
  verify: 'Verify it is you. Enter the code sent to your account email.',
  confirm: 'Final confirmation. Confirm you understand what you will lose.',
  receipt: 'Deletion request received.',
};

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Bullet({ children }: { children: string }) {
  return (
    <View accessible accessibilityLabel={children} style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bodyText}>{children}</Text>
    </View>
  );
}

function ReviewStep({
  summary,
  onContinue,
  onKeep,
  busy,
}: {
  summary: AccountDeletionSummary;
  onContinue: () => void;
  onKeep: () => void;
  busy: boolean;
}) {
  // The server tells us up front whether it can carry a request out. Showing
  // Continue anyway would walk the member through every disclosure and then
  // refuse them at the last step.
  const unavailable = !summary.acceptingRequests;
  return (
    <View style={styles.content}>
      <Section title="What will be deleted">
        <Bullet>Your sign-in account and email address</Bullet>
        <Bullet>Your profile and contact details — username, phone, city and avatar</Bullet>
        <Bullet>Your Akiba Pass, so no code of yours can be scanned again</Bullet>
        <Bullet>Saved places, notification settings and this device&apos;s registration</Bullet>
        <Bullet>The link between your Akiba account and any wallet you connected</Bullet>
        <Bullet>Photos and contributions you submitted, including unpublished ones</Bullet>
      </Section>

      <Section title="What happens to your rewards">
        <View style={styles.statRow}>
          <Stat label="AkibaMiles balance" value={String(summary.milesBalance)} />
          <Stat label="Active vouchers" value={String(summary.activeVoucherCount)} />
        </View>
        <Text style={styles.bodyText}>
          Your Akiba Pass stops working and unredeemed vouchers become unusable. We can&apos;t move Miles
          or vouchers to another account, and they can&apos;t be restored. Having a balance won&apos;t
          block your request.
        </Text>
      </Section>

      <Section title="What may remain">
        <Text style={styles.bodyText}>
          Some records are kept with your name, email and other direct identifiers removed, where an
          approved legal, settlement, fraud or audit purpose requires it. Access to those is restricted
          and each is held only for its approved retention period.
        </Text>
      </Section>

      <Section title="What Akiba cannot erase">
        <Text style={styles.bodyText}>
          Transactions already written to the Celo blockchain, and the public wallet addresses in them,
          are permanent. No one — including Akiba — can delete or change them. We remove our own
          off-chain link to your wallet where our retention plan allows it.
        </Text>
      </Section>

      <Section title="How long it takes">
        <Text style={styles.bodyText}>
          We aim to finish within {summary.processingTargetDays} calendar days of your verified request,
          unless we&apos;re legally required to hold data longer. We&apos;ll email {summary.maskedEmail}{' '}
          when it&apos;s done. You can&apos;t cancel the request yourself once you confirm it.
        </Text>
      </Section>

      <View style={styles.actions}>
        {unavailable ? (
          <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.errorBanner}>
            Deleting your account from the app isn&apos;t available just yet. Email
            hello@akibamiles.com and we&apos;ll delete your account for you — you don&apos;t need to
            explain why.
          </Text>
        ) : (
          <PrimaryButton
            accessibilityHint="Sends a verification code to your account email. Nothing is deleted yet."
            busy={busy}
            busyLabel="Sending code…"
            label="Continue"
            onPress={onContinue}
            style={styles.danger}
          />
        )}
        <TextButton
          accessibilityHint="Returns to settings without deleting anything"
          label={unavailable ? 'Back to settings' : 'Keep my account'}
          onPress={onKeep}
        />
      </View>
    </View>
  );
}

function VerifyStep({
  maskedEmail,
  code,
  onChangeCode,
  onContinue,
  onResend,
  secondsLeft,
  busy,
}: {
  maskedEmail: string | null;
  code: string;
  onChangeCode: (value: string) => void;
  onContinue: () => void;
  onResend: () => void;
  secondsLeft: number;
  busy: boolean;
}) {
  const canResend = secondsLeft === 0 && !busy;
  return (
    <View style={styles.content}>
      <Section title="Verify it&apos;s you">
        <Text style={styles.bodyText}>
          We sent a {CODE_LENGTH}-digit code to {maskedEmail ?? 'your account email'}. This code is for
          deleting your Akiba account — it is not a sign-in code.
        </Text>
      </Section>

      <FormField
        autoComplete={Platform.OS === 'ios' ? 'one-time-code' : 'sms-otp'}
        autoFocus
        inputMode="numeric"
        keyboardType="number-pad"
        label="Account deletion code"
        onChangeText={onChangeCode}
        placeholder="123456"
        style={styles.codeInput}
        textContentType="oneTimeCode"
        value={code}
      />

      <View style={styles.actions}>
        <PrimaryButton
          disabled={!isCompleteCode(code)}
          label="Continue"
          onPress={onContinue}
          style={styles.danger}
        />
        <TextButton
          accessibilityHint={
            canResend ? 'Sends a new deletion code' : `Available in ${secondsLeft} seconds`
          }
          disabled={!canResend}
          label={secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
          onPress={onResend}
        />
      </View>
    </View>
  );
}

function ConfirmStep({
  summary,
  acknowledged,
  onAcknowledge,
  onDelete,
  onBack,
  busy,
}: {
  summary: AccountDeletionSummary;
  acknowledged: boolean;
  onAcknowledge: () => void;
  onDelete: () => void;
  onBack: () => void;
  busy: boolean;
}) {
  return (
    <View style={styles.content}>
      <Section title="Last step">
        <Text style={styles.bodyText}>
          Confirming submits your deletion request. Processing takes up to {summary.processingTargetDays}{' '}
          days and cannot be undone.
        </Text>
        <View style={styles.statRow}>
          <Stat label="Miles lost" value={String(summary.milesBalance)} />
          <Stat label="Vouchers voided" value={String(summary.activeVoucherCount)} />
          <Stat label="Wallet links removed" value={String(summary.linkedWalletCount)} />
        </View>
      </Section>

      <Button
        accessibilityHint="Required before you can delete your account"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: acknowledged }}
        onPress={onAcknowledge}
        style={styles.acknowledgeRow}>
        <Icon
          color={acknowledged ? colors.danger : colors.muted}
          name={acknowledged ? 'check-square' : 'square'}
          size={22}
        />
        <Text style={styles.acknowledgeLabel}>
          I understand that I will lose access to my Akiba Pass, active vouchers, and account-based
          rewards.
        </Text>
      </Button>

      <View style={styles.actions}>
        <PrimaryButton
          accessibilityHint="This cannot be undone"
          busy={busy}
          busyLabel="Submitting…"
          disabled={!acknowledged}
          label="Delete my Akiba account"
          onPress={onDelete}
          style={styles.danger}
        />
        <TextButton
          accessibilityHint="Returns to the previous step without deleting anything"
          label="Back"
          onPress={onBack}
          tone="muted"
        />
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  screen: {
    backgroundColor: colors.paper,
  },
  page: {
    alignSelf: 'center',
    maxWidth: 640,
    paddingBottom: 48,
    paddingHorizontal: spacing.lg,
    width: '100%',
  },
  back: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 48,
    paddingRight: spacing.md,
  },
  backText: {
    color: colors.muted,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.small,
  },
  title: {
    color: colors.ink,
    fontFamily: fontFamily.sterlingSemiBold,
    fontSize: typography.display,
    marginBottom: spacing.lg,
  },
  centered: {
    alignItems: 'center',
    gap: spacing.md,
    justifyContent: 'center',
    minHeight: 280,
  },
  retry: {
    minWidth: 180,
  },
  content: {
    gap: spacing.xl,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: fontFamily.sterlingSemiBold,
    fontSize: typography.section,
  },
  bodyText: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.small,
    lineHeight: 22,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bulletDot: {
    backgroundColor: colors.danger,
    borderRadius: 999,
    height: 6,
    marginTop: 8,
    width: 6,
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stat: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderCurve: 'continuous',
    borderRadius: radius.sm,
    borderWidth: 1,
    flexGrow: 1,
    gap: 2,
    minWidth: 100,
    padding: spacing.md,
  },
  statValue: {
    color: colors.ink,
    fontFamily: fontFamily.sansBold,
    fontSize: typography.section,
  },
  statLabel: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.caption,
  },
  codeInput: {
    fontFamily: fontFamily.sansBold,
    fontSize: typography.title,
    letterSpacing: 8,
    textAlign: 'center',
  },
  acknowledgeRow: {
    alignItems: 'flex-start',
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderCurve: 'continuous',
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 48,
    padding: spacing.md,
  },
  acknowledgeLabel: {
    color: colors.ink,
    flex: 1,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.small,
    lineHeight: 21,
  },
  actions: {
    gap: spacing.sm,
  },
  // Destructiveness is carried by the label text, the warning copy and the
  // acknowledgement — not by colour alone (§13). colors.danger on white
  // measures 4.83:1, above the 4.5:1 floor.
  danger: {
    backgroundColor: colors.danger,
  },
  errorText: {
    color: colors.danger,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.small,
    textAlign: 'center',
  },
  errorBanner: {
    backgroundColor: colors.dangerTint,
    borderCurve: 'continuous',
    borderRadius: radius.sm,
    color: colors.danger,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.small,
    lineHeight: 21,
    padding: spacing.md,
  },
});
