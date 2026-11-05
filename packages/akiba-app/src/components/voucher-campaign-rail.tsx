import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fundedBenefit, type FundedOffer } from '@/contracts';
import { Icon, colors, fontFamily } from '@/design-system';
import { campaignInventoryLabel, type VoucherCampaign } from '@/lib/voucher-campaigns';

export function VoucherCampaignRail({ campaigns, fundedOffers = [] }: {
  campaigns: VoucherCampaign[];
  fundedOffers?: FundedOffer[];
}) {
  if (!campaigns.length && !fundedOffers.length) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
      {campaigns.map((campaign) => (
        <Pressable
          key={campaign.id}
          accessibilityRole="link"
          accessibilityLabel={`${campaign.title}. ${campaignInventoryLabel(campaign)}. Browse vouchers`}
          onPress={() => router.push({ pathname: '/vouchers', params: { tab: 'claim', campaign: campaign.id } })}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <View style={styles.copy}>
            <Text style={styles.eyebrow}>Voucher campaign</Text>
            <Text numberOfLines={2} style={styles.title}>{campaign.title}</Text>
            <Text style={styles.meta}>{campaignInventoryLabel(campaign)}</Text>
          </View>
          <Icon name="chevron-right" color={colors.teal} size={20} />
        </Pressable>
      ))}
      {fundedOffers.map((offer) => (
        <Pressable
          key={offer.allocationId}
          accessibilityRole="link"
          onPress={() => router.push({ pathname: '/merchants/[slug]', params: { slug: offer.merchant.slug } })}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <View style={styles.copy}>
            <Text style={styles.eyebrow}>Funded by Akiba</Text>
            <Text numberOfLines={2} style={styles.title}>{offer.title}</Text>
            <Text style={styles.meta}>{fundedBenefit(offer)}</Text>
          </View>
          <Icon name="chevron-right" color={colors.teal} size={20} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: { gap: 12, paddingVertical: 4 },
  card: { alignItems: 'center', backgroundColor: colors.tint, borderColor: colors.line, borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 108, padding: 14, width: 270 },
  copy: { flex: 1 },
  eyebrow: { color: colors.tealDark, fontFamily: fontFamily.sansSemiBold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 20, lineHeight: 24, marginTop: 4 },
  meta: { color: colors.muted, fontFamily: fontFamily.sansMedium, fontSize: 12, marginTop: 5 },
  pressed: { opacity: 0.8 },
});
