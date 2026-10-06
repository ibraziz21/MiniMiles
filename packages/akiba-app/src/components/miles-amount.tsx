import { Image } from 'expo-image';

import { StyleSheet, Text, View, colors, fontFamily, spacing, typography } from '@/design-system';

// The brand AkibaMiles glyph — reuses the same circle-mark asset already
// bundled for the app icon/splash (assets/images/splash-icon.png), not a
// new asset. Mirrors hub-page's MilesAmount (src/components/MilesIcon.tsx):
// "[icon]amount", never "amount AkibaMiles" as text.
const milesIcon = require('../../assets/images/splash-icon.png') as number;

const SIZES = {
  // Row/meta context — most cards, list rows.
  sm: { icon: 14, fontSize: typography.caption },
  // The big price/benefit display on voucher/funded/loyalty card headers —
  // mirrors hub-page's MilesAmount size="sm"/font-sterling price treatment.
  lg: { icon: 22, fontSize: typography.title },
} as const;

type MilesAmountProps = {
  amount: number;
  color?: string;
  /** Optional sign shown after the denomination symbol and before the amount. */
  prefix?: string;
  size?: keyof typeof SIZES;
};

export function MilesAmount({ amount, color = colors.ink, prefix = '', size = 'sm' }: MilesAmountProps) {
  const { icon, fontSize } = SIZES[size];
  return (
    <View style={styles.row}>
      <Image source={milesIcon} style={[styles.icon, { height: icon, width: icon }]} contentFit="contain" />
      <Text style={[styles.amount, { color, fontSize }, size === 'lg' && styles.amountLarge]}>
        {prefix}{amount.toLocaleString('en-KE')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  icon: {
    height: 14,
    width: 14,
  },
  amount: {
    fontFamily: fontFamily.sansBold,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  amountLarge: {
    fontFamily: fontFamily.serif,
    fontWeight: '700',
  },
});
