// GET /api/v1/home — native port of hub-page's MemberHome discovery surface.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Modal, Pressable, ScrollView as HorizontalScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import { DiscoveryToolbar } from '@/components/discovery-toolbar';
import { MerchantDirectoryCard } from '@/components/merchant-card';
import { fundedBenefit, type FundedOffer, type MobileHome } from '@/contracts';
import { ActivityIndicator, Icon, ScrollView, colors, fontFamily } from '@/design-system';
import { FundedOfferClaim } from '@/components/funded-offer-claim';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: MobileHome; claimedIds: string[] };

type Highlight = MobileHome['feed']['verifiedHighlights'][number];
type Place = MobileHome['feed']['sections'][number]['merchants'][number];

export default function HomeScreen() {
  const { accessToken, session } = useAuth();
  const [state, setState] = useState<ScreenState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const client = createApiClient({ accessToken });
      const [data, voucherState] = await Promise.all([
        client.getHome(),
        accessToken ? client.getVoucherState().catch(() => null) : null,
      ]);
      setState({ status: 'ready', data, claimedIds: voucherState?.claimedFundedAllocationIds ?? [] });
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong' });
    }
  }, [accessToken]);

  useEffect(() => {
    // Fetch-on-mount bridges the remote home feed into local screen state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
      style={styles.screen}>
      <View style={styles.contentShell}>
        <HomeToolbar />
        {state.status === 'loading' ? (
          <View style={styles.centered}><ActivityIndicator color={colors.teal} /></View>
        ) : state.status === 'error' ? (
          <ErrorState message={state.message} onRetry={load} />
        ) : (
          <HomeContent key={session?.user.id ?? 'guest'} data={state.data} previouslyClaimed={state.claimedIds} />
        )}
      </View>
    </ScrollView>
  );
}

function HomeContent({ data, previouslyClaimed }: { data: MobileHome; previouslyClaimed: string[] }) {
  const [selectedOffer, setSelectedOffer] = useState<FundedOffer | null>(null);
  const [claimedIds, setClaimedIds] = useState<string[]>([]);
  const insets = useSafeAreaInsets();
  const offers = data.fundedOffers.filter((offer) => offer.claimsOpen !== false && !previouslyClaimed.includes(offer.allocationId) && !claimedIds.includes(offer.allocationId));
  const newPlaces = useMemo(
    () => data.feed.sections.find((section) => section.id === 'new')?.merchants ?? [],
    [data.feed.sections],
  );
  const places = useMemo(() => {
    const seen = new Set(newPlaces.map((place) => place.id));
    const result: Place[] = [];
    for (const section of data.feed.sections.filter(({ id }) => id === 'for_you' || id === 'nearby' || id === 'popular')) {
      for (const place of section.merchants) {
        if (seen.has(place.id)) continue;
        seen.add(place.id);
        result.push(place);
        if (result.length === 4) return result;
      }
    }
    return result;
  }, [data.feed.sections, newPlaces]);
  const close = () => setSelectedOffer(null);

  return (
    <View>
      <ClaimableOffers offers={offers} onSelect={setSelectedOffer} />
      <PlaceList title="New on Akiba" places={newPlaces} />
      <VerifiedDiscovery highlights={data.feed.verifiedHighlights} />
      <PlaceList title="Places on Akiba" places={places} directoryLink />

      {offers.length === 0 && newPlaces.length === 0 && places.length === 0 && data.feed.verifiedHighlights.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="shopping-bag" size={34} color={colors.line} />
          <Text style={styles.emptyTitle}>No places to show yet</Text>
          <Text style={styles.emptyBody}>Places and offers will appear here as they become available.</Text>
        </View>
      ) : null}

      {selectedOffer ? (
        <Modal transparent animationType="slide" onRequestClose={close}>
          <View style={styles.modalRoot}>
            <Pressable accessibilityLabel="Close claim" onPress={close} style={styles.scrim} />
            <View accessibilityViewIsModal style={[styles.claimSheet, { paddingBottom: insets.bottom }]}>
              <View style={styles.claimHandle} />
              <View style={styles.claimHeader}>
                <Icon name="gift" size={21} color={colors.tealDark} />
                <Text accessibilityRole="header" style={styles.claimTitle}>Claim offer</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close claim" onPress={close} style={styles.closeClaim}>
                  <Icon name="x" size={22} color={colors.ink} />
                </Pressable>
              </View>
              <FundedOfferClaim
                allocationId={selectedOffer.allocationId}
                title={selectedOffer.title}
                merchantName={fundedPlaceLabel(selectedOffer)}
                benefit={fundedBenefit(selectedOffer)}
                minimumSpendKes={String(selectedOffer.minimumSpendKes)}
                terms={selectedOffer.terms}
                sheetOffer={selectedOffer}
                claimDeadline={fundedTiming(selectedOffer)}
                onClaimed={() => {
                  setClaimedIds((ids) => [...ids, selectedOffer.allocationId]);
                }}
                onViewVoucher={(id) => { close(); router.push(`/vouchers/${id}`); }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

function fundedPlaceLabel(offer: FundedOffer) {
  const count = offer.merchants?.length ?? 0;
  return count > 1 ? `Use at any of ${count} participating places` : offer.merchant.name;
}

function fundedTiming(offer: FundedOffer) {
  const claimEnd = new Date(offer.claimEndsAt);
  return Number.isFinite(claimEnd.getTime())
    ? `Claim by ${claimEnd.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })}`
    : null;
}

function ClaimableOffers({ offers, onSelect }: { offers: FundedOffer[]; onSelect: (offer: FundedOffer) => void }) {
  const { width } = useWindowDimensions();
  if (!offers.length) return null;
  const single = offers.length === 1;
  const cardWidth = Math.min(width - (single ? 32 : 52), 320);

  return (
    <View style={styles.section}>
      <SectionHeading title="Claimable offers" action="See all" onPress={() => router.push({ pathname: '/vouchers', params: { tab: 'claim' } })} />
      <HorizontalScrollView
        horizontal
        scrollEnabled={!single}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.spotlightRow}
        snapToInterval={single ? undefined : cardWidth + 12}
        decelerationRate="fast">
        {offers.map((offer) => {
          const multi = (offer.merchants?.length ?? 0) > 1;
          const place = fundedPlaceLabel(offer);
          const conditions = [
            offer.minimumSpendKes > 0 ? `Min. spend KES ${offer.minimumSpendKes.toLocaleString('en-KE')}` : null,
            fundedTiming(offer),
          ].filter(Boolean).join(' · ');
          return (
            <View key={offer.allocationId} style={[styles.voucherPromo, { width: cardWidth }]}>
              <View style={styles.offerHeader}>
                <View style={styles.offerTile}>
                  {!multi && offer.merchant.imageUrl ? (
                    <Image source={{ uri: offer.merchant.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : <Icon name={multi ? 'gift' : 'shopping-bag'} size={26} color={colors.tealDark} />}
                </View>
                <View style={styles.offerText}>
                  <View style={styles.offerBadge}>
                    <Icon name="check-circle" size={14} color={colors.tealDark} />
                    <Text style={styles.offerBadgeLabel}>No AkibaMiles needed</Text>
                  </View>
                  <Text style={styles.voucherPromoTitle}>{place}</Text>
                </View>
              </View>
              <View>
                <Text style={styles.voucherPromoBenefit}>{fundedBenefit(offer)}</Text>
                {conditions ? <Text style={styles.voucherPromoNote}>{conditions}</Text> : null}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Claim offer · ${place}`} onPress={() => onSelect(offer)} style={({ pressed }) => [styles.voucherPromoCta, pressed && styles.cardPressed]}>
                <Text style={styles.claimLabel}>Claim</Text>
              </Pressable>
            </View>
          );
        })}
      </HorizontalScrollView>
    </View>
  );
}

function HomeToolbar() {
  const [query, setQuery] = useState('');

  const submit = useCallback(() => {
    const value = query.trim();
    if (!value) return;
    router.push({ pathname: '/merchants', params: { q: value, from: 'home' } });
  }, [query]);

  return (
    <View style={styles.toolbarWrap}>
      <DiscoveryToolbar
        onChangeText={setQuery}
        onOpenFilters={() => router.navigate({ pathname: '/merchants', params: { filterRequest: String(Date.now()) } })}
        onSubmit={submit}
        placeholder="Search Akiba…"
        value={query}
      />
    </View>
  );
}

function VerifiedDiscovery({ highlights }: { highlights: Highlight[] }) {
  const { width } = useWindowDimensions();
  if (highlights.length === 0) return null;
  const cardWidth = Math.min(Math.max(width - 64, 280), 360);

  return (
    <View style={styles.section}>
      <SectionHeading title="Verified visits" />
      <HorizontalScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.spotlightRow} snapToInterval={cardWidth + 12} decelerationRate="fast">
        {highlights.map((highlight) => (
          <Pressable
            key={highlight.merchantId}
            onPress={() => router.push({ pathname: '/merchants/[slug]', params: { slug: highlight.merchantSlug, tab: 'verified' } })}
            style={({ pressed }) => [styles.spotlightCard, { width: cardWidth }, pressed && styles.cardPressed]}>
            <Image source={{ uri: highlight.photo.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} />
            <LinearGradient colors={['rgba(0,0,0,0.20)', 'rgba(0,0,0,0.08)', 'rgba(0,0,0,0.92)']} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />

            <View style={styles.spotlightTop}>
              <View style={styles.verifiedBadge}>
                <Icon name="check-circle" size={15} color={colors.white} />
                <Text style={styles.verifiedBadgeText}>Verified visits</Text>
              </View>
              {highlight.verifiedRecommendationBand.kind === 'exact' ? (
                <View style={styles.visitBadge}>
                  <Text style={styles.visitBadgeText}>{highlight.verifiedRecommendationBand.count} verified recommendations</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.spotlightBottom}>
              <Text style={styles.spotlightName}>{highlight.merchantName}</Text>
              {highlight.recommendedItems.length > 0 ? (
                <Text style={styles.spotlightDetail} numberOfLines={1}>Try {highlight.recommendedItems.join(' · ')}</Text>
              ) : null}
              {highlight.lovedLabels.length > 0 ? (
                <View style={styles.lovedRow}>
                  {highlight.lovedLabels.slice(0, 3).map((label) => (
                    <View key={label} style={styles.lovedBadge}>
                      <Icon name="heart" size={12} color={colors.white} />
                      <Text style={styles.lovedText}>{label}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <Text style={styles.spotlightLink}>See verified visits →</Text>
            </View>
          </Pressable>
        ))}
      </HorizontalScrollView>
    </View>
  );
}

function PlaceList({ title, places, directoryLink }: { title: string; places: Place[]; directoryLink?: boolean }) {
  if (!places.length) return null;
  return (
    <View style={styles.section}>
      <SectionHeading title={title} action={directoryLink ? 'See all' : undefined} onPress={() => router.navigate('/merchants')} />
      <View style={styles.merchantRow}>
        {places.map((merchant) => (
          <MerchantDirectoryCard key={merchant.id} merchant={merchant} onPress={() => router.push(`/merchants/${merchant.slug}`)} />
        ))}
      </View>
    </View>
  );
}

function SectionHeading({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  return (
    <View style={styles.sectionHeadingRow}>
      <Text style={styles.sectionHeading}>{title}</Text>
      {action && onPress ? (
        <Pressable onPress={onPress} style={({ pressed }) => [styles.sectionAction, pressed && styles.chipPressed]}>
          <Text style={styles.sectionActionText}>{action}</Text>
          <Icon name="arrow-right" size={14} color={colors.teal} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorState}>
      <Icon name="wifi-off" size={34} color={colors.line} />
      <Text style={styles.emptyTitle}>Explore is temporarily unavailable</Text>
      <Text style={styles.emptyBody}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.retryButton}><Text style={styles.retryText}>Retry</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  voucherPromo: { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 },
  voucherPromoNote: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 16, marginTop: 3 },
  voucherPromoTitle: { color: colors.muted, fontFamily: fontFamily.sansMedium, fontSize: 14, lineHeight: 18 },
  voucherPromoBenefit: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 16, lineHeight: 20 },
  offerHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  offerText: { flex: 1, minWidth: 0, gap: 5 },
  offerTile: { alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 12, backgroundColor: colors.tint, overflow: 'hidden' },
  offerBadge: { alignSelf: 'flex-start', alignItems: 'center', flexDirection: 'row', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.tint },
  offerBadgeLabel: { flexShrink: 1, color: colors.tealDark, fontFamily: fontFamily.sansSemiBold, fontSize: 11 },
  voucherPromoCta: { alignSelf: 'flex-end', justifyContent: 'center', minHeight: 44, marginTop: 'auto', backgroundColor: colors.tealDark, borderRadius: 12, paddingHorizontal: 16 },
  claimLabel: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  claimSheet: { maxHeight: '95%', borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.white, overflow: 'hidden' },
  claimHandle: { alignSelf: 'center', backgroundColor: colors.line, borderRadius: 4, height: 4, marginTop: 7, width: 42 },
  claimHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 5 },
  claimTitle: { flex: 1, color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 16 },
  closeClaim: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.tint },
  screen: { backgroundColor: colors.paper },
  page: { paddingBottom: 28, paddingTop: 12 },
  contentShell: { alignSelf: 'center', maxWidth: 840, width: '100%' },
  centered: { alignItems: 'center', justifyContent: 'center', minHeight: 360 },
  toolbarWrap: { marginBottom: 16, marginHorizontal: 16 },
  chipPressed: { backgroundColor: colors.tint, opacity: 0.88 },
  section: { marginBottom: 28 },
  sectionHeadingRow: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 16 },
  sectionHeading: { color: colors.ink, flex: 1, fontFamily: fontFamily.sterlingSemiBold, fontSize: 21, lineHeight: 26 },
  sectionAction: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', gap: 4, minHeight: 44, paddingHorizontal: 8 },
  sectionActionText: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 12 },
  spotlightRow: { gap: 12, paddingHorizontal: 16 },
  spotlightCard: { backgroundColor: colors.ink, borderCurve: 'continuous', borderRadius: 24, height: 304, overflow: 'hidden', position: 'relative' },
  cardPressed: { opacity: 0.92, transform: [{ scale: 0.995 }] },
  spotlightTop: { flexDirection: 'row', gap: 8, justifyContent: 'space-between', left: 14, position: 'absolute', right: 14, top: 14 },
  verifiedBadge: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999, flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 6 },
  verifiedBadgeText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 11 },
  visitBadge: { backgroundColor: 'rgba(255,255,255,0.90)', borderRadius: 999, flexShrink: 1, paddingHorizontal: 10, paddingVertical: 6 },
  visitBadgeText: { color: colors.ink, fontFamily: fontFamily.sansBold, fontSize: 10, textAlign: 'center' },
  spotlightBottom: { bottom: 0, left: 0, padding: 16, position: 'absolute', right: 0 },
  spotlightName: { color: colors.white, fontFamily: fontFamily.sterlingSemiBold, fontSize: 24, lineHeight: 28 },
  spotlightDetail: { color: 'rgba(255,255,255,0.85)', fontFamily: fontFamily.sansMedium, fontSize: 14, marginTop: 4 },
  lovedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  lovedBadge: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 999, flexDirection: 'row', gap: 4, paddingHorizontal: 10, paddingVertical: 5 },
  lovedText: { color: colors.white, fontFamily: fontFamily.sansMedium, fontSize: 11 },
  spotlightLink: { color: 'rgba(255,255,255,0.80)', fontFamily: fontFamily.sansSemiBold, fontSize: 12, marginTop: 12 },
  merchantRow: { gap: 4, paddingHorizontal: 16 },
  emptyState: { alignItems: 'center', borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderStyle: 'dashed', borderWidth: 1, marginHorizontal: 16, padding: 36 },
  emptyTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 20, marginTop: 12, textAlign: 'center' },
  emptyBody: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: 'center' },
  errorState: { alignItems: 'center', borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderStyle: 'dashed', borderWidth: 1, margin: 16, padding: 36 },
  retryButton: { backgroundColor: colors.teal, borderRadius: 999, marginTop: 16, paddingHorizontal: 20, paddingVertical: 11 },
  retryText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
});
