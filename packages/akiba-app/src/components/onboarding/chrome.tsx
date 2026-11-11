import type { ReactNode } from 'react';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, PrimaryButton, colors, fontFamily, spacing, typography } from '@/design-system';

const mark = require('../../../assets/images/splash-icon.png') as number;

/**
 * Shared look for the intro slides, the email/code screens and the setup
 * steps (the Stitch onboarding export). Two layouts and nothing else, so
 * every screen lines up when swiping or stepping through:
 *
 * - `showcase`: an app-UI visual block, then a centred headline and body.
 * - `form`: centred headline and body at the top, then fields.
 *
 * Both pin the primary button and its secondary link to the bottom. The
 * scroll container's flexGrow + the footer's marginTop:auto keeps them there
 * on a normal screen while still letting the largest text sizes scroll
 * instead of clipping (AKIBA-MOB-001 §5). The visual block shrinks on short
 * phones for the same reason.
 */

export function visualHeight(windowHeight: number): number {
  return Math.round(Math.max(220, Math.min(320, windowHeight * 0.38)));
}

/** Pale teal glow across the top third, fading into the paper background. */
export function GlowBackground() {
  return (
    <LinearGradient
      colors={[colors.tint, colors.paper]}
      pointerEvents="none"
      style={styles.glow}
    />
  );
}

export function AkibaMark({ size }: { size: number }) {
  return <Image accessibilityIgnoresInvertColors source={mark} style={{ height: size, width: size }} contentFit="contain" />;
}

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Go back"
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
      <Icon name="arrow-left" size={20} color={colors.ink} />
    </Pressable>
  );
}

export function ProgressBars({ current, total }: { current: number; total: number }) {
  return (
    <View
      accessible
      accessibilityLabel={`Step ${current} of ${total}`}
      accessibilityRole="progressbar"
      style={styles.bars}>
      {Array.from({ length: total }, (_, index) => (
        <View key={index} style={[styles.bar, index < current && styles.barFilled]} />
      ))}
    </View>
  );
}

export type HeaderProps = {
  /** Shows the Akiba logo + name on the left instead of a back button. */
  logo?: boolean;
  onBack?: () => void;
  progress?: { current: number; total: number };
};

export function OnboardingHeader({ logo, onBack, progress }: HeaderProps) {
  return (
    <View style={styles.header}>
      {logo ? (
        <View style={styles.brand}>
          <AkibaMark size={26} />
          <Text style={styles.brandName}>Akiba</Text>
        </View>
      ) : onBack ? (
        <BackButton onPress={onBack} />
      ) : (
        <View />
      )}
      {progress ? <ProgressBars current={progress.current} total={progress.total} /> : null}
    </View>
  );
}

export function Headline({ title, body }: { title: string; body?: ReactNode }) {
  return (
    <View style={styles.copy}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

/** A plain text action under the primary button: "Not now", "Sign in"… */
export function SecondaryLink({
  label,
  emphasis,
  onPress,
}: {
  label: string;
  /** Bold trailing words, e.g. "Sign in" after "Already have an account?". */
  emphasis?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={emphasis ? `${label} ${emphasis}` : label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
      <Text style={styles.secondaryLabel}>
        {label}
        {emphasis ? <Text style={styles.secondaryEmphasis}>{` ${emphasis}`}</Text> : null}
      </Text>
    </Pressable>
  );
}

export type FooterProps = {
  primaryLabel: string;
  onPrimary: () => void;
  primaryBusy?: boolean;
  primaryBusyLabel?: string;
  primaryDisabled?: boolean;
  primaryHint?: string;
  secondary?: ReactNode;
  /** Page-level error (a failed save), announced and shown above the CTA. */
  error?: string | null;
};

export function OnboardingFooter({
  primaryLabel,
  onPrimary,
  primaryBusy,
  primaryBusyLabel,
  primaryDisabled,
  primaryHint,
  secondary,
  error,
}: FooterProps) {
  return (
    <View style={styles.footer}>
      {error ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <PrimaryButton
        accessibilityHint={primaryHint}
        busy={primaryBusy}
        busyLabel={primaryBusyLabel}
        disabled={primaryDisabled}
        label={primaryLabel}
        onPress={onPrimary}
        style={styles.primary}
      />
      {secondary}
    </View>
  );
}

type ScreenProps = HeaderProps &
  FooterProps & {
    layout: 'showcase' | 'form';
    title: string;
    body?: ReactNode;
    /** Showcase only: the app-UI fragment shown above the headline. */
    visual?: ReactNode;
    /** Form fields (form) or anything under the headline (showcase). */
    children?: ReactNode;
    /** Shows the Akiba mark above a form headline (the email screen). */
    mark?: boolean;
  };

export function OnboardingScreen({
  layout,
  title,
  body,
  visual,
  children,
  mark,
  logo,
  onBack,
  progress,
  ...footer
}: ScreenProps) {
  const { height } = useWindowDimensions();

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.shell}>
      <GlowBackground />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.content}>
            <OnboardingHeader logo={logo} onBack={onBack} progress={progress} />
            {layout === 'showcase' ? (
              <>
                <View style={[styles.visual, { height: visualHeight(height) }]}>{visual}</View>
                <Headline body={body} title={title} />
                {children}
              </>
            ) : (
              <>
                <View style={styles.formTop}>
                  {mark ? <AkibaMark size={40} /> : null}
                  <Headline body={body} title={title} />
                </View>
                <View style={styles.fields}>{children}</View>
              </>
            )}
          </View>
          {/* Showcase screens pin the CTA to the bottom so it sits at the
              same height on every slide. Form screens keep it right under
              the fields — pinned, it drifts far from the input whenever the
              keyboard is closed. */}
          <View style={[styles.content, layout === 'showcase' ? styles.footerPinned : styles.footerInline]}>
            <OnboardingFooter {...footer} />
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
  fill: {
    flex: 1,
  },
  glow: {
    height: 280,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
    paddingHorizontal: 20,
  },
  content: {
    alignSelf: 'center',
    maxWidth: 520,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 56,
    justifyContent: 'space-between',
  },
  brand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  brandName: {
    color: colors.ink,
    fontFamily: fontFamily.sansBold,
    fontSize: typography.subtitle,
  },
  back: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  pressed: {
    opacity: 0.6,
  },
  bars: {
    flexDirection: 'row',
    gap: 6,
    width: 112,
  },
  bar: {
    backgroundColor: colors.line,
    borderRadius: 2,
    flex: 1,
    height: 4,
  },
  barFilled: {
    backgroundColor: colors.teal,
  },
  visual: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  copy: {
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.sm,
  },
  title: {
    color: colors.ink,
    fontFamily: fontFamily.sansBold,
    fontSize: typography.display,
    letterSpacing: -0.4,
    lineHeight: 36,
    textAlign: 'center',
  },
  body: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.body,
    lineHeight: 24,
    maxWidth: 300,
    textAlign: 'center',
  },
  formTop: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  fields: {
    gap: spacing.xl,
    marginTop: spacing.xxl,
  },
  footerPinned: {
    marginTop: 'auto',
  },
  footerInline: {
    marginTop: spacing.sm,
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.xl,
  },
  primary: {
    minHeight: 56,
  },
  secondary: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  secondaryLabel: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: 15,
    textAlign: 'center',
  },
  secondaryEmphasis: {
    color: colors.ink,
    fontFamily: fontFamily.sansSemiBold,
  },
  error: {
    color: colors.danger,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.small,
    textAlign: 'center',
  },
});
