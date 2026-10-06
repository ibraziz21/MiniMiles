import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { Badge, Button, Card, Icon, IconChip, StyleSheet, Text, View, colors, fontFamily, spacing, typography } from '@/design-system';
import type { ClaimFriction, LoyaltyOffer, LoyaltyQualificationOutcome } from '@/contracts';

type LoyaltyOfferCardProps = {
  offer: LoyaltyOffer;
  /** Not per-offer — the member-wide claim friction from the voucher-state overlay this card was rendered from. */
  claimFriction: ClaimFriction;
};

function benefitLabel(offer: LoyaltyOffer): string {
  if (offer.voucherType === 'percent_off') {
    return `${offer.discountPercent ?? 0}% off`;
  }
  if (offer.voucherType === 'fixed_off') return `KES ${(offer.discountKes ?? 0).toLocaleString('en-KE')} off`;
  if (offer.voucherType === 'bogo') return 'Buy one, get one';
  return 'Free item';
}

function progressLabel(outcome: LoyaltyQualificationOutcome): string {
  if (outcome.type === 'merchant_purchase_count') {
    return `${outcome.actual ?? 0} of ${outcome.minimum} purchases`;
  }
  return `KES ${(outcome.actual ?? 0).toLocaleString('en-KE')} of ${outcome.minimum.toLocaleString('en-KE')} spent`;
}

// Satisfied fills green (matches hub-page's bg-emerald-500), in-progress
// fills teal — previously always teal regardless of satisfaction, a real
// fidelity gap against the web version, not just a style tweak.
function ProgressBar({ outcome }: { outcome: LoyaltyQualificationOutcome }) {
  const actual = Math.max(outcome.actual ?? 0, 0);
  const percent = outcome.minimum > 0 ? Math.min(100, Math.max(0, Math.floor((actual / outcome.minimum) * 100))) : 100;
  return (
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          { width: `${outcome.satisfied ? 100 : percent}%` },
          outcome.satisfied && styles.progressFillSatisfied,
        ]}
      />
    </View>
  );
}

export function LoyaltyOfferCard({ offer, claimFriction }: LoyaltyOfferCardProps) {
  const locked = offer.accessPolicy === 'loyalty_qualified' && !offer.eligible && !offer.alreadyClaimed;
  const badgeLabel = offer.alreadyClaimed ? 'Claimed' : locked ? 'Locked' : offer.acquisitionMode === 'free' ? 'Free' : 'Available';
  const badgeTone = offer.alreadyClaimed || locked ? 'muted' : 'teal';

  const content = (
    <Card elevation="chip" style={styles.card}>
      <LinearGradient colors={[colors.tint, colors.white]} style={styles.header}>
        <View style={styles.headerRow}>
          <IconChip name={locked ? 'lock' : 'award'} />
          <Badge label={badgeLabel} tone={badgeTone} />
        </View>
        <Text style={styles.benefit}>{benefitLabel(offer)}</Text>
      </LinearGradient>

      <View style={styles.body}>
        <Text style={styles.merchant} numberOfLines={1}>
          {offer.merchant.name}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {offer.title}
        </Text>

        {locked && offer.progress.length > 0 ? (
          <View style={styles.progressGroup}>
            {offer.progress.map((outcome) => (
              <View key={outcome.type} style={styles.progressRow}>
                <View style={styles.progressLabelRow}>
                  {outcome.satisfied ? <Icon name="check-circle" size={12} color={colors.success} /> : null}
                  <Text style={styles.progressLabel}>{progressLabel(outcome)}</Text>
                </View>
                <ProgressBar outcome={outcome} />
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  );

  if (offer.alreadyClaimed) return content;

  return (
    <Button
      onPress={() =>
        router.push({
          pathname: '/vouchers/loyalty/[templateId]',
          params: {
            templateId: offer.templateId,
            title: offer.title,
            merchantName: offer.merchant.name,
            benefit: benefitLabel(offer),
            customerCopy: offer.customerCopy ?? '',
            acquisitionMode: offer.acquisitionMode,
            milesCost: String(offer.milesCost),
            eligible: String(offer.eligible),
            progress: JSON.stringify(offer.progress),
            claimFriction: JSON.stringify(claimFriction),
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
  benefit: {
    color: colors.ink,
    fontFamily: fontFamily.serif,
    fontSize: typography.title,
    fontWeight: '700',
  },
  body: {
    gap: 2,
    padding: spacing.lg,
  },
  merchant: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.caption,
  },
  title: {
    color: colors.ink,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: typography.small,
    fontWeight: '600',
  },
  progressGroup: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  progressRow: {
    gap: 4,
  },
  progressLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  progressLabel: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.micro,
  },
  progressTrack: {
    backgroundColor: colors.line,
    borderRadius: 999,
    height: 6,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    backgroundColor: colors.teal,
    borderRadius: 999,
    height: '100%',
  },
  progressFillSatisfied: {
    backgroundColor: colors.success,
  },
});
