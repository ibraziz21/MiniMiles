import type { ComponentProps } from 'react';
import { StyleSheet, View as NativeView } from 'react-native';

import { colors, radius, shadows, spacing } from './tokens';

type CardProps = ComponentProps<typeof NativeView> & {
  /** 'chip' uses the lighter shadow (smaller cards/rows); default is the soft shadow hub-page's main cards use. */
  elevation?: 'soft' | 'chip';
};

export function Card({ style, elevation = 'soft', ...props }: CardProps) {
  return <NativeView {...props} style={[styles.card, elevation === 'soft' ? shadows.soft : shadows.chip, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderCurve: 'continuous',
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
  },
});
