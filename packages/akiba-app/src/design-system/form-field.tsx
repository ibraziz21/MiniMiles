import { useId } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fontFamily, radius, spacing, typography } from './tokens';

type FormFieldProps = TextInputProps & {
  /** Always rendered — never a placeholder standing in for a label (§2). */
  label: string;
  /** Static guidance shown under the field. */
  hint?: string;
  /** Validation message. Rendered beside the field it belongs to and announced. */
  error?: string | null;
};

/**
 * A labelled text input with its error message attached to it.
 *
 * Three AKIBA-MOB-001 §5 rules live here so no screen has to remember
 * them: the label is a real visible label (not a placeholder), the error
 * sits directly under its own field rather than in a page-level banner,
 * and the error is announced — `accessibilityLiveRegion` covers TalkBack,
 * `accessibilityRole="alert"` covers VoiceOver. The input itself clears the
 * 44pt/48dp target via `minHeight`.
 */
export function FormField({ label, hint, error, style, ...inputProps }: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <View style={styles.field}>
      <Text nativeID={id} style={styles.label}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityLabelledBy={id}
        accessibilityHint={hint}
        aria-errormessage={error ? errorId : undefined}
        aria-invalid={!!error}
        placeholderTextColor={colors.muted}
        style={[styles.input, !!error && styles.inputInvalid, style]}
        {...inputProps}
      />
      {hint && !error ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          nativeID={errorId}
          style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs,
  },
  label: {
    color: colors.ink,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: typography.small,
  },
  input: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderCurve: 'continuous',
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fontFamily.sans,
    fontSize: typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  inputInvalid: {
    borderColor: colors.danger,
  },
  hint: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.caption,
  },
  error: {
    color: colors.danger,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.caption,
  },
});
