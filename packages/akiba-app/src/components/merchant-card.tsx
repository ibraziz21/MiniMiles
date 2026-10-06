import { memo } from 'react';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, colors, fontFamily } from '@/design-system';
import type { MerchantValueSummary } from '@/contracts';

import { MilesAmount } from './miles-amount';

type MerchantCardProps = {
  merchant: MerchantValueSummary;
  onPress: () => void;
};

function MerchantCardMedia({ merchant }: { merchant: MerchantValueSummary }) {
  return (
    <LinearGradient colors={[colors.tint, colors.card]} style={styles.media}>
      {merchant.bannerUrl ? (
        <Image source={{ uri: merchant.bannerUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
      ) : merchant.logoUrl ? (
        <Image
          source={{ uri: merchant.logoUrl }}
          style={styles.logoBackdrop}
          contentFit="cover"
          blurRadius={22}
          transition={160}
        />
      ) : null}

      {!merchant.bannerUrl ? (
        <View style={styles.logoWell}>
          {merchant.logoUrl ? (
            <Image source={{ uri: merchant.logoUrl }} style={styles.logo} contentFit="contain" transition={160} />
          ) : (
            <Icon name="shopping-bag" size={28} color={colors.teal} />
          )}
        </View>
      ) : null}

      {merchant.bannerUrl && merchant.logoUrl ? (
        <View style={styles.bannerLogoWell}>
          <Image source={{ uri: merchant.logoUrl }} style={styles.bannerLogo} contentFit="contain" transition={160} />
        </View>
      ) : null}
    </LinearGradient>
  );
}

function MerchantFacts({ merchant, recommendation }: { merchant: MerchantValueSummary; recommendation: boolean }) {
  const location = merchant.nearestLocation;
  const category = merchant.matchedOffering ?? merchant.primaryCategory?.name;

  return (
    <View style={styles.body}>
      <View style={styles.nameRow}>
        <Text style={styles.name} numberOfLines={1}>{merchant.name}</Text>
        {merchant.operatingModel === 'online' ? <Icon name="globe" size={14} color={colors.muted} /> : null}
      </View>

      {category ? <Text style={styles.category} numberOfLines={1}>{category}</Text> : null}

      {location ? (
        <View style={styles.factRow}>
          <Icon name="map-pin" size={12} color={colors.muted} />
          <Text style={styles.factText} numberOfLines={1}>
            {location.locality ? `${location.locality}, ` : ''}{location.city}
            {location.distanceKm != null ? ` · ${location.distanceKm.toFixed(1)} km` : ''}
            {!recommendation && merchant.branchCount && merchant.branchCount > 1 ? ` · ${merchant.branchCount} branches` : ''}
          </Text>
        </View>
      ) : null}

      {recommendation && merchant.reasons.length > 0 ? (
        <View style={styles.reasonRow}>
          {merchant.reasons.slice(0, 1).map((reason, index) => (
            <View key={`${reason.kind}-${index}`} style={styles.reasonChip}>
              <Text style={styles.reasonText}>{reasonLabel(reason)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.badgeRow}>
          <View style={styles.neutralBadge}>
            <Text style={styles.neutralBadgeText}>
              {merchant.operatingModel === 'online' ? 'Online' : merchant.operatingModel === 'hybrid' ? 'In store · Online' : 'In store'}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.footer}>
        <View style={styles.offerArea}>
          {recommendation && merchant.topOffer ? (
            <View style={styles.milesRow}>
              <Icon name="tag" size={12} color={colors.teal} />
              <MilesAmount amount={merchant.topOffer.milesCost} size="sm" />
            </View>
          ) : merchant.voucherCount && merchant.voucherCount > 0 ? (
            <View style={styles.voucherBadge}>
              <Icon name="tag" size={12} color={colors.teal} />
              <Text style={styles.voucherText}>
                {merchant.voucherCount} voucher{merchant.voucherCount === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.viewLabel}>View merchant →</Text>
      </View>
    </View>
  );
}

function reasonLabel(reason: MerchantValueSummary['reasons'][number]) {
  if (reason.kind === 'distance' && reason.distanceKm != null) return `${reason.distanceKm.toFixed(1)} km away`;
  if (reason.kind === 'affordable') return 'You can unlock this';
  return reason.label ?? (reason.kind === 'new' ? 'New' : 'Recommended');
}

export const MerchantValueCard = memo(function MerchantValueCard({ merchant, onPress }: MerchantCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.valueCard, pressed && styles.cardPressed]}>
      <MerchantCardMedia merchant={merchant} />
      <MerchantFacts merchant={merchant} recommendation />
    </Pressable>
  );
});

export const MerchantDirectoryCard = memo(function MerchantDirectoryCard({ merchant, onPress }: MerchantCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.directoryCard, pressed && styles.cardPressed]}>
      <MerchantCardMedia merchant={merchant} />
      <MerchantFacts merchant={merchant} recommendation={false} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderCurve: 'continuous',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  valueCard: {
    width: 280,
  },
  directoryCard: {
    width: '100%',
  },
  cardPressed: {
    borderColor: 'rgba(35,141,157,0.42)',
    transform: [{ scale: 0.992 }],
  },
  media: {
    alignItems: 'center',
    height: 128,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  logoBackdrop: {
    bottom: 0,
    left: 0,
    opacity: 0.28,
    position: 'absolute',
    right: 0,
    top: 0,
    transform: [{ scale: 1.5 }],
  },
  logoWell: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: 'rgba(13,14,12,0.05)',
    borderCurve: 'continuous',
    borderRadius: 16,
    borderWidth: 1,
    boxShadow: '0 8px 24px rgba(13,14,12,0.10)',
    height: 64,
    justifyContent: 'center',
    padding: 8,
    width: 64,
  },
  logo: {
    height: '100%',
    width: '100%',
  },
  bannerLogoWell: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: 'rgba(13,14,12,0.05)',
    borderCurve: 'continuous',
    borderRadius: 12,
    borderWidth: 1,
    bottom: 8,
    height: 40,
    justifyContent: 'center',
    left: 8,
    padding: 6,
    position: 'absolute',
    width: 40,
  },
  bannerLogo: {
    height: '100%',
    width: '100%',
  },
  body: {
    flex: 1,
    padding: 14,
  },
  nameRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  name: {
    color: colors.ink,
    flex: 1,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 16,
    lineHeight: 20,
  },
  category: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6,
  },
  factRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
  },
  factText: {
    color: colors.muted,
    flex: 1,
    fontFamily: fontFamily.sans,
    fontSize: 12,
    lineHeight: 16,
  },
  reasonRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  reasonChip: {
    backgroundColor: colors.tint,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  reasonText: {
    color: colors.teal,
    fontFamily: fontFamily.sansMedium,
    fontSize: 11,
    lineHeight: 15,
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  neutralBadge: {
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  neutralBadgeText: {
    color: colors.muted,
    fontFamily: fontFamily.sansMedium,
    fontSize: 11,
    lineHeight: 15,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    marginTop: 'auto',
    paddingTop: 4,
  },
  offerArea: {
    flex: 1,
  },
  milesRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  voucherBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.tint,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  voucherText: {
    color: colors.teal,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 11,
    lineHeight: 15,
  },
  viewLabel: {
    color: colors.teal,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
});
