import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fontFamily, spacing, typography } from './tokens';

type TextButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  tone?: 'teal' | 'muted';
  style?: StyleProp<ViewStyle>;
};

/**
 * Low-emphasis action (resend, change email, skip). Uses `tealDark`, not
 * `teal`, for the same 4.5:1 reason as PrimaryButton, and keeps the 48dp
 * target even though the text itself is short.
 */
export function TextButton({
  label,
  onPress,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  tone = 'teal',
  style,
}: TextButtonProps) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, style]}>
      <Text style={[styles.label, tone === 'muted' && styles.labelMuted, disabled && styles.labelDisabled]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
  label: {
    color: colors.tealDark,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: typography.small,
    textAlign: 'center',
  },
  labelMuted: {
    color: colors.muted,
  },
  labelDisabled: {
    color: colors.muted,
    opacity: 0.7,
  },
});
