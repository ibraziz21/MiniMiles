// GET /api/v1/home — native port of hub-page's MemberHome discovery surface.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, type Href } from 'expo-router';
import { Pressable, ScrollView as HorizontalScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import { DiscoveryToolbar } from '@/components/discovery-toolbar';
import { MerchantValueCard } from '@/components/merchant-card';
import { fundedBenefit, type FundedOffer, type MobileHome } from '@/contracts';
import { ActivityIndicator, Icon, ScrollView, colors, fontFamily } from '@/design-system';
import { merchantOfferAvailability } from '@/lib/merchant-offer-availability';

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: MobileHome };

type Intent = MobileHome['feed']['intents'][number];
type Highlight = MobileHome['feed']['verifiedHighlights'][number];
type FeedSection = MobileHome['feed']['sections'][number];
type BusinessOffer = MobileHome['feed']['businessOffers'][number];

const INTENT_ICONS: Record<string, 'wifi' | 'shopping-cart' | 'smartphone' | 'coffee' | 'gift' | 'tag' | 'battery-charging'> = {
  wifi: 'wifi',
  'shopping-basket': 'shopping-cart',
  smartphone: 'smartphone',
  coffee: 'coffee',
  gift: 'gift',
  fuel: 'battery-charging',
};

export default function HomeScreen() {
  const { accessToken } = useAuth();
  const [state, setState] = useState<ScreenState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const data = await createApiClient({ accessToken }).getHome();
      setState({ status: 'ready', data });
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
          <HomeContent data={state.data} />
        )}
      </View>
    </ScrollView>
  );
}

function HomeContent({ data }: { data: MobileHome }) {
  const sections = useMemo(() => data.feed.sections.filter((section) => section.merchants.length > 0), [data.feed.sections]);

  return (
    <View>
      <IntentShortcuts intents={data.feed.intents} />
      <DiscoveryVouchers offers={data.fundedOffers} />
      <BusinessOffers offers={data.feed.businessOffers} />
      <VerifiedDiscovery highlights={data.feed.verifiedHighlights} />

      {sections.map((section) => <MerchantRail key={section.id} section={section} />)}

      {data.fundedOffers.length === 0 && sections.length === 0 && data.feed.verifiedHighlights.length === 0 && data.feed.businessOffers.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="shopping-bag" size={34} color={colors.line} />
          <Text style={styles.emptyTitle}>No places to show yet</Text>
          <Text style={styles.emptyBody}>Partner merchants will appear here as they become available.</Text>
        </View>
      ) : null}
    </View>
  );
}

function DiscoveryVouchers({ offers }: { offers: FundedOffer[] }) {
  if (offers.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeading title="A little extra for your next visit" />
      {offers.slice(0, 4).map((offer) => {
        const weekend = offer.redemptionSchedule?.days.length === 2 && offer.redemptionSchedule.days.includes(0) && offer.redemptionSchedule.days.includes(6);
        return (
          <Pressable
            key={offer.allocationId}
            accessibilityRole="link"
            accessibilityLabel={`Going to ${offer.merchant.name}${weekend ? ' this weekend' : ''}? ${fundedBenefit(offer)}. Claim now`}
            onPress={() => router.push({ pathname: '/vouchers', params: { tab: 'claim' } })}
            style={({ pressed }) => [styles.voucherPromo, pressed && { opacity: 0.85 }]}>
            <Text style={styles.voucherPromoNote}>On Akiba. No Miles needed.</Text>
            <Text style={styles.voucherPromoTitle}>Going to {offer.merchant.name}{weekend ? ' this weekend' : ''}?</Text>
            <Text style={styles.voucherPromoBenefit}>{fundedBenefit(offer)} on your bill</Text>
            <Text style={styles.voucherPromoNote}>Minimum bill KES {offer.minimumSpendKes.toLocaleString('en-KE')}. {offer.eligibilitySummary ?? 'Eligibility requirements apply.'}</Text>
            <Text style={styles.voucherPromoCta}>{offer.claimsOpen === false && offer.claimStartsAt ? `View offer · claims open ${new Date(offer.claimStartsAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })}` : 'Claim now ↗'}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function BusinessOffers({ offers }: { offers: BusinessOffer[] }) {
  const { width } = useWindowDimensions();
  if (offers.length === 0) return null;
  const single = offers.length === 1;
  const cardWidth = single ? Math.max(width - 32, 280) : Math.min(Math.max(width - 64, 280), 330);

  return (
    <View style={styles.section}>
      <SectionHeading
        title="Business offers"
        action={single ? undefined : 'See all'}
        onPress={single ? undefined : () => router.push('/offers' as Href)}
      />
      <HorizontalScrollView
        horizontal
        scrollEnabled={!single}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.businessOfferRow}
        snapToInterval={single ? undefined : cardWidth + 12}
        decelerationRate="fast">
        {offers.map((offer) => <BusinessOfferCard key={offer.id} offer={offer} width={cardWidth} />)}
      </HorizontalScrollView>
    </View>
  );
}

function BusinessOfferCard({ offer, width }: { offer: BusinessOffer; width: number }) {
  const availability = merchantOfferAvailability(offer);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/merchants/${offer.partner.slug}`)}
      style={({ pressed }) => [styles.businessOfferCard, { width }, pressed && styles.cardPressed]}>
      <View style={styles.businessOfferImageWrap}>
        {offer.thumbnailUrl ? (
          <Image accessibilityLabel="" source={{ uri: offer.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
        ) : (
          <View style={styles.businessOfferFallback}>
            {offer.partner.logoUrl ? (
              <Image accessibilityLabel="" source={{ uri: offer.partner.logoUrl }} style={styles.businessOfferLogo} contentFit="contain" />
            ) : (
              <Icon name="shopping-bag" size={30} color={colors.teal} />
            )}
          </View>
        )}
        <View style={styles.businessOfferStatus}><Text style={styles.businessOfferStatusText}>{availability.label}</Text></View>
      </View>
      <View style={styles.businessOfferBody}>
        <Text numberOfLines={1} style={styles.businessOfferMerchant}>{offer.partner.name}</Text>
        <Text numberOfLines={2} style={styles.businessOfferTitle}>{offer.title}</Text>
        <Text style={styles.businessOfferMiles}>No AkibaMiles required</Text>
      </View>
    </Pressable>
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

function IntentShortcuts({ intents }: { intents: Intent[] }) {
  if (intents.length === 0) return null;
  return (
    <View style={styles.intentSection}>
      <HorizontalScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.intentRow}>
        {intents.map((intent) => (
          <Pressable
            key={intent.id}
            onPress={() => router.push({ pathname: '/merchants', params: { q: intent.query, intent: intent.slug } })}
            style={({ pressed }) => [styles.intentChip, pressed && styles.chipPressed]}>
            <View style={styles.intentIcon}>
              <Icon name={INTENT_ICONS[intent.iconKey] ?? 'tag'} size={16} color={colors.teal} />
            </View>
            <Text style={styles.intentLabel}>{intent.label}</Text>
          </Pressable>
        ))}
      </HorizontalScrollView>
    </View>
  );
}

function VerifiedDiscovery({ highlights }: { highlights: Highlight[] }) {
  const { width } = useWindowDimensions();
  if (highlights.length === 0) return null;
  const cardWidth = Math.min(Math.max(width - 64, 280), 360);

  return (
    <View style={styles.section}>
      <SectionHeading title="Places people loved" action="Explore" onPress={() => router.navigate('/merchants')} />
      <HorizontalScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.spotlightRow} snapToInterval={cardWidth + 12} decelerationRate="fast">
        {highlights.map((highlight) => (
          <Pressable
            key={highlight.merchantId}
            onPress={() => router.push(`/merchants/${highlight.merchantSlug}`)}
            style={({ pressed }) => [styles.spotlightCard, { width: cardWidth }, pressed && styles.cardPressed]}>
            <Image source={{ uri: highlight.photo.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} />
            <LinearGradient colors={['rgba(0,0,0,0.20)', 'rgba(0,0,0,0.08)', 'rgba(0,0,0,0.92)']} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />

            <View style={styles.spotlightTop}>
              <View style={styles.verifiedBadge}>
                <Icon name="check-circle" size={15} color={colors.white} />
                <Text style={styles.verifiedBadgeText}>Verified visits</Text>
              </View>
              <View style={styles.visitBadge}>
                <Text style={styles.visitBadgeText}>
                  {highlight.verifiedRecommendationBand.kind === 'exact'
                    ? `${highlight.verifiedRecommendationBand.count} visits`
                    : 'New from verified visits'}
                </Text>
              </View>
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
              <Text style={styles.spotlightLink}>See verified photos and details →</Text>
            </View>
          </Pressable>
        ))}
      </HorizontalScrollView>
    </View>
  );
}

function MerchantRail({ section }: { section: FeedSection }) {
  return (
    <View style={styles.section}>
      <SectionHeading title={section.title} action="See all" onPress={() => router.navigate('/merchants')} />
      <HorizontalScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.merchantRow} snapToInterval={292} decelerationRate="fast">
        {section.merchants.map((merchant) => (
          <MerchantValueCard key={merchant.id} merchant={merchant} onPress={() => router.push(`/merchants/${merchant.slug}`)} />
        ))}
      </HorizontalScrollView>
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
  voucherPromo: { backgroundColor: colors.tint, borderColor: colors.line, borderWidth: 1, borderRadius: 24, padding: 22, marginTop: 12, gap: 12 },
  voucherPromoNote: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 18 },
  voucherPromoTitle: { color: colors.ink, fontFamily: fontFamily.sans, fontSize: 24, fontWeight: '600', lineHeight: 30 },
  voucherPromoBenefit: { color: colors.tealDark, fontFamily: fontFamily.sans, fontSize: 18, fontWeight: '600', lineHeight: 25 },
  voucherPromoCta: { color: colors.white, backgroundColor: colors.tealDark, borderRadius: 12, paddingHorizontal: 16, paddingBottom: 14, fontFamily: fontFamily.sans, fontSize: 14, fontWeight: '600', minHeight: 44, paddingTop: 14 },
  screen: { backgroundColor: colors.paper },
  page: { paddingBottom: 28, paddingTop: 12 },
  contentShell: { alignSelf: 'center', maxWidth: 840, width: '100%' },
  centered: { alignItems: 'center', justifyContent: 'center', minHeight: 360 },
  toolbarWrap: { marginBottom: 16, marginHorizontal: 16 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  intentSection: { marginBottom: 20 },
  intentRow: { gap: 8, paddingHorizontal: 16 },
  intentChip: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 44, paddingLeft: 6, paddingRight: 14 },
  chipPressed: { backgroundColor: colors.tint, opacity: 0.88 },
  intentIcon: { alignItems: 'center', backgroundColor: colors.tint, borderRadius: 999, height: 32, justifyContent: 'center', width: 32 },
  intentLabel: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 12 },
  section: { marginBottom: 28 },
  sectionHeadingRow: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 16 },
  sectionHeading: { color: colors.ink, flex: 1, fontFamily: fontFamily.sterlingSemiBold, fontSize: 21, lineHeight: 26 },
  sectionAction: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', gap: 4, minHeight: 44, paddingHorizontal: 8 },
  sectionActionText: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 12 },
  spotlightRow: { gap: 12, paddingHorizontal: 16 },
  businessOfferRow: { gap: 12, paddingHorizontal: 16 },
  businessOfferCard: { backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 22, borderWidth: 1, overflow: 'hidden' },
  businessOfferImageWrap: { backgroundColor: colors.tint, height: 150, position: 'relative' },
  businessOfferFallback: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  businessOfferLogo: { backgroundColor: colors.white, borderRadius: 16, height: 62, padding: 6, width: 62 },
  businessOfferStatus: { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 999, left: 12, paddingHorizontal: 10, paddingVertical: 6, position: 'absolute', top: 12 },
  businessOfferStatusText: { color: colors.ink, fontFamily: fontFamily.sansBold, fontSize: 10 },
  businessOfferBody: { minHeight: 118, padding: 15 },
  businessOfferMerchant: { color: colors.muted, fontFamily: fontFamily.sansMedium, fontSize: 12 },
  businessOfferTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 20, lineHeight: 24, marginTop: 4 },
  businessOfferMiles: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 11, marginTop: 11 },
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
  merchantRow: { gap: 12, paddingHorizontal: 16 },
  emptyState: { alignItems: 'center', borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderStyle: 'dashed', borderWidth: 1, marginHorizontal: 16, padding: 36 },
  emptyTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 20, marginTop: 12, textAlign: 'center' },
  emptyBody: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: 'center' },
  errorState: { alignItems: 'center', borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderStyle: 'dashed', borderWidth: 1, margin: 16, padding: 36 },
  retryButton: { backgroundColor: colors.teal, borderRadius: 999, marginTop: 16, paddingHorizontal: 20, paddingVertical: 11 },
  retryText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
});
