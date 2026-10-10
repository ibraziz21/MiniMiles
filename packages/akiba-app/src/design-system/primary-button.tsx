import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fontFamily, radius, spacing, typography } from './tokens';

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Replaces the label while an action is in flight, and blocks re-entry. */
  busyLabel?: string;
  busy?: boolean;
  /** Spoken instead of the label when the visible text isn't self-describing. */
  accessibilityLabel?: string;
  /** Spoken after the label — e.g. "step 2 of 3". */
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * The app's primary call to action. Two accessibility requirements are
 * baked in here rather than left to each screen (AKIBA-MOB-001 §5):
 * `minHeight: 48` clears both the 44pt iOS and 48dp Android targets, and
 * the fill is `tealDark` rather than `teal` because white 16px text on
 * `teal` measures 3.9:1 — below the 4.5:1 normal-text floor — while
 * `tealDark` measures 4.75:1.
 */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  busyLabel,
  accessibilityLabel,
  accessibilityHint,
  style,
}: PrimaryButtonProps) {
  const blocked = disabled || busy;
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [styles.button, blocked && styles.blocked, pressed && styles.pressed, style]}>
      <Text style={styles.label}>{busy && busyLabel ? busyLabel : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.tealDark,
    borderCurve: 'continuous',
    borderRadius: radius.full,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  blocked: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    color: colors.white,
    fontFamily: fontFamily.sansBold,
    fontSize: typography.body,
    textAlign: 'center',
  },
});
