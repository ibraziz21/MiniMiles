import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { Badge, Button, Card, IconChip, StyleSheet, Text, View, colors, fontFamily, spacing, typography } from '@/design-system';
import type { VoucherTemplate } from '@/contracts';

import { MilesAmount } from './miles-amount';

type VoucherTemplateCardProps = {
  template: VoucherTemplate;
  /** null when signed out, or balance hasn't loaded yet — never implies "not affordable". */
  balance: number | null;
};

// Gradient tint header + big serif price mirrors hub-page's voucher/
// funded/loyalty card header treatment (bg-gradient-to-br from-akiba-tint
// to-white, font-sterling price) — same layout as FundedOfferCard and
// LoyaltyOfferCard below it, not a one-off.
export function VoucherTemplateCard({ template, balance }: VoucherTemplateCardProps) {
  const affordable = balance != null && balance >= template.miles_cost;

  // Always tappable, even when unaffordable — the real quote call is what
  // decides INSUFFICIENT_MILES, never a client-side guess from `balance`.
  return (
    <Button
      onPress={() =>
        router.push({
          pathname: '/vouchers/purchase/[templateId]',
          params: {
            templateId: template.id,
            title: template.title,
            merchantName: template.partners?.name ?? '',
            milesCost: String(template.miles_cost),
          },
        })
      }>
      <Card elevation="chip" style={styles.card}>
        <LinearGradient colors={[colors.tint, colors.white]} style={styles.header}>
          <View style={styles.headerRow}>
            <IconChip name="shopping-bag" />
            {affordable ? <Badge label="Affordable" tone="teal" /> : null}
          </View>
          <MilesAmount amount={template.miles_cost} color={colors.ink} size="lg" />
        </LinearGradient>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {template.title}
          </Text>
          {template.partners ? (
            <Text style={styles.merchant} numberOfLines={1}>
              {template.partners.name}
            </Text>
          ) : null}
        </View>
      </Card>
    </Button>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 190,
    overflow: 'hidden',
    padding: 0,
  },
  header: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  body: {
    gap: 2,
    padding: spacing.lg,
  },
  title: {
    color: colors.ink,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: typography.small,
    fontWeight: '700',
  },
  merchant: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.caption,
  },
});
