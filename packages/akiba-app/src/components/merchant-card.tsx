import { memo, useState, type ComponentProps } from 'react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MaterialIcon, colors, fontFamily, shadows } from '@/design-system';
import type { MerchantValueSummary } from '@/contracts';


type MerchantCardProps = {
  merchant: MerchantValueSummary;
  onPress: () => void;
};

type CategoryIcon = ComponentProps<typeof MaterialIcon>['name'];

function categoryIcon(merchant: MerchantValueSummary): CategoryIcon {
  const category = merchant.primaryCategory?.slug ?? '';
  if (/coffee|cafe|bakery/.test(category)) return 'coffee';
  if (/food|dining|restaurant/.test(category)) return 'silverware-fork-knife';
  if (/grocer|supermarket/.test(category)) return 'cart-outline';
  if (/salon|beauty|barber/.test(category)) return 'content-cut';
  if (/electronic|tech/.test(category)) return 'monitor';
  return merchant.operatingModel === 'online' ? 'web' : 'storefront-outline';
}

function DirectoryThumbnail({ bannerUrl, logoUrl, icon, monogram }: {
  bannerUrl: string | null;
  logoUrl: string | null;
  icon: CategoryIcon;
  monogram: string | null;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const banner = bannerUrl && !failed.includes(bannerUrl) ? bannerUrl : null;
  const logo = logoUrl && !failed.includes(logoUrl) ? logoUrl : null;
  const image = banner ?? logo;

  return (
    <View style={[styles.thumbnail, !image && !monogram && styles.iconThumbnail]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {image ? (
        <Image
          source={{ uri: image }}
          style={banner ? StyleSheet.absoluteFill : styles.logo}
          contentFit={banner ? 'cover' : 'contain'}
          recyclingKey={image}
          onError={() => setFailed((current) => [...current, image])}
        />
      ) : monogram ? (
        <View style={styles.monogram}><Text allowFontScaling={false} style={styles.monogramText}>{monogram}</Text></View>
      ) : <MaterialIcon name={icon} size={40} color={cardColors.forest} />}
      {banner ? (
        <View style={styles.thumbnailBadge}><MaterialIcon name={icon} size={12} color={cardColors.green} /></View>
      ) : null}
    </View>
  );
}

export const MerchantDirectoryCard = memo(function MerchantDirectoryCard({ merchant, onPress }: MerchantCardProps) {
  const location = merchant.nearestLocation;
  const onlineOnly = merchant.operatingModel === 'online';
  const area = location ? [...new Set([location.locality, location.city].filter(Boolean))].join(', ') : null;
  const category = merchant.primaryCategory?.name;
  const where = onlineOnly ? 'Online only'
    : merchant.operatingModel === 'hybrid' ? [area, 'In store & online'].filter(Boolean).join(' · ')
    : area ?? 'In store';
  const monogram = onlineOnly ? null : merchant.name.trim().match(/[\p{L}\p{N}]/u)?.[0].toLocaleUpperCase() ?? null;

  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.directoryCard, pressed && styles.directoryPressed]}>
      <DirectoryThumbnail
        key={JSON.stringify([merchant.bannerUrl, merchant.logoUrl])}
        bannerUrl={merchant.bannerUrl}
        logoUrl={merchant.logoUrl}
        icon={categoryIcon(merchant)}
        monogram={monogram}
      />
      <View style={styles.directoryBody}>
        <Text numberOfLines={1} style={styles.name}>{merchant.name}</Text>
        {category ? <Text numberOfLines={1} style={styles.metadata}>{category}</Text> : null}
        <Text numberOfLines={1} style={styles.metadata}>{where}</Text>
      </View>
      <View style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <MaterialIcon name="chevron-right" size={20} color={cardColors.metadata} />
      </View>
    </Pressable>
  );
});

// Card surfaces and accents from the Places Stitch export.
const cardColors = {
  surface: '#FFFFFF',
  ink: '#131B2E',
  metadata: '#404942',
  forest: '#0F5132',
  green: '#006C49',
  mutedSurface: '#F2F3FF',
  onlineSurface: '#E2E7FF',
};

const styles = StyleSheet.create({
  directoryCard: {
    ...shadows.chip,
    alignItems: 'center',
    backgroundColor: cardColors.surface,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    minHeight: 88,
    padding: 12,
    width: '100%',
  },
  directoryPressed: { backgroundColor: colors.tint },
  thumbnail: { alignItems: 'center', backgroundColor: cardColors.mutedSurface, borderRadius: 12, height: 64, justifyContent: 'center', overflow: 'hidden', width: 64 },
  iconThumbnail: { backgroundColor: cardColors.onlineSurface },
  logo: { height: 64, width: 64 },
  monogram: { alignItems: 'center', backgroundColor: cardColors.forest, height: 64, justifyContent: 'center', width: 64 },
  monogramText: { color: cardColors.surface, fontFamily: fontFamily.sansBold, fontSize: 30 },
  thumbnailBadge: { alignItems: 'center', backgroundColor: cardColors.surface, borderRadius: 8, bottom: 4, height: 16, justifyContent: 'center', position: 'absolute', right: 4, width: 16 },
  directoryBody: { flex: 1, justifyContent: 'center', minWidth: 0 },
  name: { color: cardColors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 18, lineHeight: 24 },
  metadata: { color: cardColors.metadata, flexShrink: 1, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 16 },
  chevron: { paddingLeft: 4 },
});
