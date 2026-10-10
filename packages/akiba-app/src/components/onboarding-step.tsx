import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { track } from '@/analytics';
import { useMember } from '@/member';
import {
  ONBOARDING_STEPS,
  saveOnboardingStep,
  stepIndex,
  type OnboardingStep,
} from '@/onboarding';
import {
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

type OnboardingStepScreenProps = {
  step: OnboardingStep;
  title: string;
  intro: string;
  children?: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryBusy?: boolean;
  primaryBusyLabel?: string;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Page-level error (a failed save), announced and shown above the CTA. */
  error?: string | null;
};

/**
 * Shared chrome for the three onboarding steps (AKIBA-MOB-001 §3).
 *
 * Two behaviours live here so each step can't forget them: viewing a step
 * records it as the resume point (§4 — force-quitting mid-flow comes back
 * to the same place), and emits `onboarding_step_viewed`.
 *
 * There is no animation anywhere in this flow, which is how §5's "usable
 * without animation" is satisfied — not by detecting a reduce-motion
 * setting, but by never depending on motion in the first place.
 */
export function OnboardingStepScreen({
  step,
  title,
  intro,
  children,
  primaryLabel,
  onPrimary,
  primaryBusy = false,
  primaryBusyLabel,
  primaryDisabled = false,
  secondaryLabel,
  onSecondary,
  error,
}: OnboardingStepScreenProps) {
  const { state } = useMember();
  const userId = state.status === 'ready' ? state.bootstrap.user.id : null;
  const announced = useRef<OnboardingStep | null>(null);
  const position = stepIndex(step) + 1;
  const total = ONBOARDING_STEPS.length;

  useEffect(() => {
    if (announced.current === step) return;
    announced.current = step;
    track('onboarding_step_viewed', { step, position, total });
  }, [step, position, total]);

  useEffect(() => {
    if (!userId) return;
    void saveOnboardingStep(userId, step);
  }, [userId, step]);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.shell}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}>
        <View style={styles.content}>
          <View style={styles.progress}>
            <Text style={styles.progressLabel}>{`Step ${position} of ${total}`}</Text>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.dots}>
              {ONBOARDING_STEPS.map((candidate, index) => (
                <View key={candidate} style={[styles.dot, index < position && styles.dotFilled]} />
              ))}
            </View>
          </View>

          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Text style={styles.intro}>{intro}</Text>

          {children}
        </View>

        <View style={styles.footer}>
          {error ? (
            <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          <PrimaryButton
            accessibilityHint={`Step ${position} of ${total}`}
            busy={primaryBusy}
            busyLabel={primaryBusyLabel}
            disabled={primaryDisabled}
            label={primaryLabel}
            onPress={onPrimary}
          />
          {secondaryLabel && onSecondary ? (
            <TextButton label={secondaryLabel} onPress={onSecondary} tone="muted" />
          ) : null}
        </View>
      </ScrollView>
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
  // flexGrow + the footer's marginTop:auto keeps the CTA at the bottom on a
  // tall screen but lets it push down past the fold at the largest text
  // sizes, instead of pinning it and clipping the content above.
  scrollContent: {
    flexGrow: 1,
    padding: spacing.xl,
  },
  content: {
    alignSelf: 'center',
    gap: spacing.md,
    maxWidth: 520,
    width: '100%',
  },
  progress: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  progressLabel: {
    color: colors.muted,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: typography.caption,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  dot: {
    backgroundColor: colors.line,
    borderRadius: 999,
    flex: 1,
    height: 4,
  },
  dotFilled: {
    backgroundColor: colors.teal,
  },
  title: {
    color: colors.ink,
    fontFamily: fontFamily.sterlingSemiBold,
    fontSize: typography.display,
    lineHeight: 36,
  },
  intro: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.body,
    lineHeight: 24,
  },
  footer: {
    alignSelf: 'center',
    gap: spacing.sm,
    marginTop: 'auto',
    maxWidth: 520,
    paddingTop: spacing.xl,
    width: '100%',
  },
  error: {
    color: colors.danger,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.small,
  },
});
