import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, spacing, typography } from './tokens';

type BadgeProps = {
  label: string;
  /** 'muted' mirrors hub-page's claimed/locked pill (bg-akiba-card text-akiba-muted). */
  tone?: 'teal' | 'ink' | 'muted';
};

// Pill badge — uppercase, tracked-out, bold — mirrors the status pills on
// hub-page's voucher/funded-offer/loyalty cards (e.g. "Claimed"/"Locked"/
// "Free"/"Available"), previously hand-rolled per card with slightly
// different styles each time.
const TONE_COLORS: Record<NonNullable<BadgeProps['tone']>, { background: string; foreground: string }> = {
  teal: { background: colors.teal, foreground: colors.white },
  ink: { background: colors.ink, foreground: colors.white },
  muted: { background: colors.card, foreground: colors.muted },
};

export function Badge({ label, tone = 'ink' }: BadgeProps) {
  const { background, foreground } = TONE_COLORS[tone];
  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      <Text style={[styles.label, { color: foreground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  label: {
    fontFamily: fontFamily.sansBold,
    fontSize: typography.micro,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
