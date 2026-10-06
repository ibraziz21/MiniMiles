import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { Badge, Button, Card, IconChip, StyleSheet, Text, View, colors, fontFamily, spacing, typography } from '@/design-system';
import type { FundedOffer } from '@/contracts';

type FundedOfferCardProps = {
  offer: FundedOffer;
  claimed: boolean;
};

export function FundedOfferCard({ offer, claimed }: FundedOfferCardProps) {
  const content = (
    <Card elevation="chip" style={styles.card}>
      <LinearGradient colors={[colors.tint, colors.white]} style={styles.header}>
        <View style={styles.headerRow}>
          <IconChip name="gift" />
          <Badge label={claimed ? 'Claimed' : 'Free'} tone={claimed ? 'muted' : 'teal'} />
        </View>
        <Text style={styles.price}>KES {offer.discountKes.toLocaleString('en-KE')} off</Text>
      </LinearGradient>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {offer.title}
        </Text>
        <Text style={styles.merchant} numberOfLines={1}>
          {offer.merchant.name}
        </Text>
        <Text style={styles.terms}>Min. spend KES {offer.minimumSpendKes.toLocaleString('en-KE')}</Text>
      </View>
    </Card>
  );

  if (claimed) return content;

  return (
    <Button
      onPress={() =>
        router.push({
          pathname: '/vouchers/funded/[allocationId]',
          params: {
            allocationId: offer.allocationId,
            title: offer.title,
            merchantName: offer.merchant.name,
            discountKes: String(offer.discountKes),
            minimumSpendKes: String(offer.minimumSpendKes),
          },
        })
      }>
      {content}
    </Button>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 200,
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
  price: {
    color: colors.ink,
    fontFamily: fontFamily.serif,
    fontSize: typography.title,
    fontWeight: '700',
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
  terms: {
    color: colors.teal,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: typography.caption,
    fontWeight: '600',
    marginTop: 2,
  },
});
