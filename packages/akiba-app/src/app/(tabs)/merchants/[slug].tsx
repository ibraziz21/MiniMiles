// GET /api/v1/merchants/:slug + private merchant-state overlay. This is a
// native translation of hub-page's current merchant profile, not a separate
// mobile information architecture.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Linking, Modal, Pressable, ScrollView as HorizontalScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import { FundedOfferCard } from '@/components/funded-offer-card';
import { MilesAmount } from '@/components/miles-amount';
import type {
  CustomerPhoto,
  MerchantDetail,
  MerchantLocation,
  MerchantMedia,
  MerchantStateDetail,
  PublicVoucherSummary,
  VerifiedVisit,
} from '@/contracts';
import { ActivityIndicator, Icon, ScrollView, colors, fontFamily } from '@/design-system';

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: MerchantDetail; overlay: MerchantStateDetail | null };

type ProfileTab = 'verified' | 'merchant' | 'vouchers' | 'locations';

export default function MerchantDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { accessToken } = useAuth();
  const [state, setState] = useState<ScreenState>({ status: 'loading' });
  const [saved, setSaved] = useState(false);
  const [savePending, setSavePending] = useState(false);

  const load = useCallback(async () => {
    try {
      const detail = await createApiClient().getMerchantDetail(slug);
      let overlay: MerchantStateDetail | null = null;
      if (accessToken) {
        try {
          overlay = await createApiClient({ accessToken }).getMerchantStateDetail(slug);
        } catch {
          overlay = null;
        }
      }
      setState({ status: 'ready', detail, overlay });
      setSaved(overlay?.saved ?? false);
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong' });
    }
  }, [accessToken, slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const toggleSave = useCallback(async () => {
    if (!accessToken || savePending) return;
    const previous = saved;
    setSaved(!previous);
    setSavePending(true);
    try {
      const client = createApiClient({ accessToken });
      if (previous) await client.unsaveMerchant(slug);
      else await client.saveMerchant(slug);
    } catch {
      setSaved(previous);
    } finally {
      setSavePending(false);
    }
  }, [accessToken, savePending, saved, slug]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page} style={styles.screen}>
        {state.status === 'loading' ? (
          <View style={styles.centered}><ActivityIndicator color={colors.teal} /></View>
        ) : state.status === 'error' ? (
          <ErrorState message={state.message} onRetry={load} />
        ) : (
          <MerchantProfile
            detail={state.detail}
            onToggleSave={toggleSave}
            overlay={state.overlay}
            savePending={savePending}
            saved={saved}
          />
        )}
      </ScrollView>
    </>
  );
}

function MerchantProfile({
  detail,
  onToggleSave,
  overlay,
  savePending,
  saved,
}: {
  detail: MerchantDetail;
  onToggleSave: () => void;
  overlay: MerchantStateDetail | null;
  savePending: boolean;
  saved: boolean;
}) {
  const { merchant, vouchers, fundedOffers } = detail;
  const claimedIds = useMemo(() => new Set(overlay?.claimedFundedAllocationIds ?? []), [overlay?.claimedFundedAllocationIds]);
  const totalOffers = vouchers.length + fundedOffers.length;
  const defaultTab: ProfileTab = totalOffers > 0
    ? 'vouchers'
    : overlay?.verifiedVisit || merchant.verifiedVisits.length > 0 || merchant.approvedCustomerPhotos.length > 0
      ? 'verified'
      : merchant.merchantMedia.length > 0
        ? 'merchant'
        : merchant.locations.length > 0 ? 'locations' : 'verified';
  const [activeTab, setActiveTab] = useState<ProfileTab>(defaultTab);
  const [expanded, setExpanded] = useState(false);

  const availableTabs: ProfileTab[] = merchant.locations.length > 0
    ? ['verified', 'merchant', 'vouchers', 'locations']
    : ['verified', 'merchant', 'vouchers'];

  return (
    <View>
      <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
        <Icon name="arrow-left" size={16} color={colors.muted} />
        <Text style={styles.backText}>All merchants</Text>
      </Pressable>

      {merchant.bannerUrl ? (
        <View style={styles.bannerWrap}>
          <Image source={{ uri: merchant.bannerUrl }} style={styles.banner} contentFit="cover" priority="high" transition={180} />
          <LogoWell merchantName={merchant.name} logoUrl={merchant.logoUrl} style={styles.bannerLogo} />
        </View>
      ) : null}

      <View style={styles.identity}>
        <View style={styles.identityRow}>
          {!merchant.bannerUrl ? <LogoWell merchantName={merchant.name} logoUrl={merchant.logoUrl} style={styles.inlineLogo} /> : null}
          <View style={styles.identityBody}>
            <View style={styles.nameRow}>
              <Text style={styles.merchantName}>{merchant.name}</Text>
              <Pressable
                accessibilityLabel={saved ? 'Remove from saved merchants' : 'Save this merchant'}
                accessibilityState={{ selected: saved, busy: savePending }}
                onPress={onToggleSave}
                style={({ pressed }) => [styles.saveButton, saved && styles.saveButtonActive, pressed && styles.pressed]}>
                {savePending ? <ActivityIndicator color={colors.teal} size="small" /> : <Icon name="bookmark" size={17} color={saved ? colors.teal : colors.ink} />}
              </Pressable>
            </View>
            {merchant.shortDescription ? <Text style={styles.shortDescription}>{merchant.shortDescription}</Text> : null}
            <View style={styles.chipRow}>
              {merchant.primaryCategory ? <Pill label={merchant.primaryCategory.name} tone="teal" /> : null}
              {merchant.categories.filter((item) => item.slug !== merchant.primaryCategory?.slug).map((item) => <Pill key={item.slug} label={item.name} />)}
              <Pill label={merchant.operatingModel === 'online' ? 'Online' : merchant.operatingModel === 'hybrid' ? 'In store · Online' : 'In store'} />
            </View>
          </View>
        </View>

        {merchant.description || merchant.coreOfferings.length > 0 ? (
          <View style={styles.disclosure}>
            {merchant.description ? <Text numberOfLines={expanded ? undefined : 2} style={styles.description}>{merchant.description}</Text> : null}
            {expanded && merchant.coreOfferings.length > 0 ? (
              <View style={styles.offerings}>
                <Text style={styles.microHeading}>What they offer</Text>
                <View style={styles.chipRow}>{merchant.coreOfferings.map((offering) => <Pill key={offering.id} label={offering.name} />)}</View>
              </View>
            ) : null}
            {(merchant.coreOfferings.length > 0 || (merchant.description?.length ?? 0) > 120) ? (
              <Pressable onPress={() => setExpanded((current) => !current)} style={styles.seeMore}>
                <Text style={styles.seeMoreText}>{expanded ? 'See less' : 'See more'}</Text>
                <Icon name="chevron-down" size={16} color={colors.ink} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <QuickActions merchant={merchant} />
      </View>

      <View style={styles.tabs}>
        {availableTabs.map((tab) => (
          <TabButton key={tab} active={activeTab === tab} tab={tab} onPress={() => setActiveTab(tab)} />
        ))}
      </View>

      {activeTab === 'verified' ? (
        <VerifiedPanel merchantName={merchant.name} overlay={overlay} visits={merchant.verifiedVisits} customerPhotos={merchant.approvedCustomerPhotos} />
      ) : activeTab === 'merchant' ? (
        <BusinessGallery merchantName={merchant.name} media={merchant.merchantMedia} />
      ) : activeTab === 'vouchers' ? (
        <VouchersPanel merchantName={merchant.name} vouchers={vouchers} fundedOffers={fundedOffers} claimedIds={claimedIds} balance={overlay?.balance ?? null} />
      ) : (
        <LocationsPanel locations={merchant.locations} />
      )}
    </View>
  );
}

function LogoWell({ merchantName, logoUrl, style }: { merchantName: string; logoUrl: string | null; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.logoWell, style]}>
      {logoUrl ? <Image source={{ uri: logoUrl }} style={styles.logoImage} contentFit="contain" transition={160} /> : <Icon name="shopping-bag" size={30} color={colors.muted} />}
    </View>
  );
}

function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'teal' }) {
  return <View style={[styles.pill, tone === 'teal' && styles.pillTeal]}><Text style={[styles.pillText, tone === 'teal' && styles.pillTextTeal]}>{label}</Text></View>;
}

function QuickActions({ merchant }: { merchant: MerchantDetail['merchant'] }) {
  const primaryLocation = merchant.locations.find((location) => location.isPrimary) ?? merchant.locations[0];
  const actions = [
    primaryLocation ? { label: 'Directions', icon: 'navigation' as const, primary: true, url: directionsUrl(primaryLocation) } : null,
    merchant.contacts.phone ? { label: 'Call', icon: 'phone' as const, url: `tel:${merchant.contacts.phone}` } : null,
    merchant.contacts.whatsapp ? { label: 'WhatsApp', icon: 'message-circle' as const, url: `https://wa.me/${merchant.contacts.whatsapp.replace(/[^\d]/g, '')}` } : null,
    merchant.websiteUrl ? { label: 'Website', icon: 'globe' as const, url: merchant.websiteUrl } : null,
    merchant.contacts.instagram ? { label: 'Instagram', icon: 'instagram' as const, compact: true, url: merchant.contacts.instagram } : null,
    merchant.contacts.facebook ? { label: 'Facebook', icon: 'facebook' as const, compact: true, url: merchant.contacts.facebook } : null,
    merchant.contacts.email ? { label: 'Email', icon: 'mail' as const, compact: true, url: `mailto:${merchant.contacts.email}` } : null,
  ].filter(Boolean) as { label: string; icon: 'navigation' | 'phone' | 'message-circle' | 'globe' | 'instagram' | 'facebook' | 'mail'; primary?: boolean; compact?: boolean; url: string }[];

  if (actions.length === 0) return null;
  return (
    <HorizontalScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRow}>
      {actions.map((action) => (
        <Pressable
          accessibilityLabel={action.label}
          key={action.label}
          onPress={() => Linking.openURL(action.url)}
          style={({ pressed }) => [styles.action, action.primary && styles.actionPrimary, action.compact && styles.actionCompact, pressed && styles.pressed]}>
          <Icon name={action.icon} size={16} color={action.primary ? colors.white : colors.ink} />
          {!action.compact ? <Text style={[styles.actionText, action.primary && styles.actionTextPrimary]}>{action.label}</Text> : null}
        </Pressable>
      ))}
    </HorizontalScrollView>
  );
}

function TabButton({ active, onPress, tab }: { active: boolean; onPress: () => void; tab: ProfileTab }) {
  const values = {
    verified: { label: 'Verified', icon: 'camera' as const },
    merchant: { label: 'Business', icon: 'shopping-bag' as const },
    vouchers: { label: 'Vouchers', icon: 'tag' as const },
    locations: { label: 'Locations', icon: 'map-pin' as const },
  }[tab];
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}>
      <Icon name={values.icon} size={18} color={active ? colors.ink : colors.muted} />
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{values.label}</Text>
      <View style={[styles.tabIndicator, active && styles.tabIndicatorActive]} />
    </Pressable>
  );
}

function VerifiedPanel({ merchantName, overlay, visits, customerPhotos }: { merchantName: string; overlay: MerchantStateDetail | null; visits: VerifiedVisit[]; customerPhotos: CustomerPhoto[] }) {
  const attached = new Set(visits.flatMap((visit) => visit.photos.map((photo) => photo.id)));
  const posts = [
    ...visits.map((visit) => ({ ...visit, recommendation: true })),
    ...customerPhotos.filter((photo) => !attached.has(photo.id)).map((photo) => ({ id: `photo-${photo.id}`, experienceLabels: [], photos: [photo], recommendation: false })),
  ];
  const [selected, setSelected] = useState<(typeof posts)[number] | null>(null);
  return (
    <View style={styles.panel}>
      {overlay?.openContributionRequest ? (
        <View style={styles.contributionCard}>
          <View style={styles.roundIcon}><Icon name="message-square" size={20} color={colors.teal} /></View>
          <View style={styles.flex}><Text style={styles.cardTitle}>Your Akiba visit is verified</Text><Text style={styles.cardBody}>Add what you tried, what you would recommend and optional photos.</Text></View>
        </View>
      ) : null}
      {overlay?.verifiedVisit ? (
        <View style={styles.privateVisit}>
          <View style={styles.roundIconTint}><Icon name="check-circle" size={20} color={colors.teal} /></View>
          <View style={styles.flex}><Text style={styles.cardTitle}>Your verified visit</Text><Text style={styles.privateBadge}>Only visible to you</Text><Text style={styles.cardBody}>{memberVisitCopy(overlay.verifiedVisit, merchantName)}</Text></View>
        </View>
      ) : null}
      {posts.length === 0 ? (
        <EmptyPanel icon="check-circle" title="No verified visits yet" body="Recommendations and approved photos from verified Akiba visits will appear here." />
      ) : posts.map((post) => {
        const cover = post.photos[0];
        return (
          <Pressable key={post.id} onPress={() => setSelected(post)} style={({ pressed }) => [styles.visitCard, pressed && styles.pressed]}>
            {cover ? <Image source={{ uri: cover.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} /> : <View style={[StyleSheet.absoluteFill, styles.visitFallback]} />}
            {cover ? <LinearGradient colors={['rgba(0,0,0,0.18)', 'rgba(0,0,0,0.78)']} style={StyleSheet.absoluteFill} /> : null}
            <View style={[styles.verifiedVisitBadge, !cover && styles.verifiedVisitBadgeLight]}><Icon name="check-circle" size={15} color={cover ? colors.white : colors.teal} /><Text style={[styles.verifiedVisitBadgeText, !cover && styles.verifiedVisitBadgeTextDark]}>Verified visit</Text></View>
            <View style={styles.visitCardBottom}><Text style={[styles.visitTitle, !cover && styles.visitTitleDark]}>{post.recommendation ? `Would recommend ${merchantName}` : `A verified visit to ${merchantName}`}</Text><Text style={[styles.visitHint, !cover && styles.visitHintDark]}>Tap to see the verified visit</Text></View>
          </Pressable>
        );
      })}
      <VisitModal merchantName={merchantName} onClose={() => setSelected(null)} post={selected} />
    </View>
  );
}

function VisitModal({ merchantName, onClose, post }: { merchantName: string; onClose: () => void; post: { experienceLabels: string[]; photos: CustomerPhoto[]; recommendation: boolean } | null }) {
  const insets = useSafeAreaInsets();
  const [photoIndex, setPhotoIndex] = useState(0);
  const photo = post?.photos[photoIndex];
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={Boolean(post)}>
      <View style={styles.modalScrim}>
        <View style={[styles.visitModal, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          {photo ? <Image source={{ uri: photo.displayUrl }} style={styles.modalPhoto} contentFit="contain" /> : <View style={styles.modalPhotoFallback}><Icon name="check-circle" size={64} color="rgba(35,141,157,0.25)" /></View>}
          <Pressable accessibilityLabel="Close verified visit" onPress={onClose} style={styles.modalClose}><Icon name="x" size={20} color={colors.ink} /></Pressable>
          {post && post.photos.length > 1 ? <View style={styles.photoNav}><Pressable onPress={() => setPhotoIndex((photoIndex - 1 + post.photos.length) % post.photos.length)} style={styles.photoNavButton}><Icon name="chevron-left" size={20} color={colors.white} /></Pressable><Text style={styles.photoCount}>{photoIndex + 1} / {post.photos.length}</Text><Pressable onPress={() => setPhotoIndex((photoIndex + 1) % post.photos.length)} style={styles.photoNavButton}><Icon name="chevron-right" size={20} color={colors.white} /></Pressable></View> : null}
          {post ? <View style={styles.modalCopy}><Text style={styles.modalEyebrow}>Verified Akiba visit</Text><Text style={styles.modalTitle}>{post.recommendation ? `Would recommend ${merchantName}` : `A verified visit to ${merchantName}`}</Text>{post.experienceLabels.length > 0 ? <View style={styles.chipRow}>{post.experienceLabels.map((label) => <Pill key={label} label={label} tone="teal" />)}</View> : null}<Text style={styles.modalFootnote}>Shared anonymously after an eligible Akiba purchase. Verification confirms the visit, not every detail shown in a photo.</Text></View> : null}
        </View>
      </View>
    </Modal>
  );
}

function BusinessGallery({ media, merchantName }: { media: MerchantMedia[]; merchantName: string }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex == null ? null : media[selectedIndex];
  return (
    <View style={styles.businessPanel}>
      <View style={styles.panelIntro}><Text style={styles.panelIntroText}>Provided by {merchantName}. Product and business photos are not customer verification.</Text><Text style={styles.panelCount}>{media.length} {media.length === 1 ? 'photo' : 'photos'}</Text></View>
      {media.length === 0 ? <EmptyPanel icon="shopping-bag" title="No business photos yet" body={`${merchantName} has not added photos to this gallery yet.`} /> : <View style={styles.photoGrid}>{media.map((photo, index) => <Pressable key={photo.id} onPress={() => setSelectedIndex(index)} style={styles.gridPhotoButton}><Image source={{ uri: photo.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={140} /></Pressable>)}</View>}
      <Modal animationType="fade" onRequestClose={() => setSelectedIndex(null)} visible={Boolean(selected)}>
        <View style={styles.galleryModal}><View style={styles.galleryHeader}><View><Text style={styles.galleryMerchant}>{merchantName}</Text><Text style={styles.gallerySource}>From the business</Text></View><Pressable onPress={() => setSelectedIndex(null)} style={styles.galleryClose}><Icon name="x" size={24} color={colors.white} /></Pressable></View>{selected ? <Image source={{ uri: selected.imageUrl }} style={styles.galleryImage} contentFit="contain" /> : null}{selected && selectedIndex != null ? <Text style={styles.galleryCaption}>{selected.title ?? selected.altText}  {selectedIndex + 1} of {media.length}</Text> : null}</View>
      </Modal>
    </View>
  );
}

function VouchersPanel({ balance, claimedIds, fundedOffers, merchantName, vouchers }: { balance: number | null; claimedIds: Set<string>; fundedOffers: MerchantDetail['fundedOffers']; merchantName: string; vouchers: PublicVoucherSummary[] }) {
  const count = vouchers.length + fundedOffers.length;
  return (
    <View style={styles.panel}>
      <PanelHeading title={`Offers at ${merchantName}`} description={count > 0 ? 'Akiba-funded offers first, then vouchers available with Miles.' : 'Vouchers for this merchant will appear here.'} count={`${count} ${count === 1 ? 'offer' : 'offers'}`} />
      {count === 0 ? <EmptyPanel icon="tag" title="No vouchers right now" body="Check back later, or browse offers available from other Akiba merchants." /> : null}
      {fundedOffers.map((offer) => <FundedOfferCard key={offer.allocationId} offer={offer} claimed={claimedIds.has(offer.allocationId)} />)}
      {vouchers.map((voucher) => <MerchantVoucher key={voucher.id} balance={balance} merchantName={merchantName} voucher={voucher} />)}
    </View>
  );
}

function MerchantVoucher({ balance, merchantName, voucher }: { balance: number | null; merchantName: string; voucher: PublicVoucherSummary }) {
  const gap = balance == null ? null : Math.max(0, voucher.milesCost - balance);
  const value = voucher.voucherType === 'percent_off' && voucher.discountPercent != null ? `${voucher.discountPercent}% off` : voucher.voucherType === 'fixed_off' && voucher.discountCusd != null ? `KES ${voucher.discountCusd.toLocaleString('en-KE')} off` : voucher.retailValueCusd != null ? `KES ${voucher.retailValueCusd.toLocaleString('en-KE')} value` : 'Reward';
  return (
    <View style={styles.voucherCard}>
      <View style={styles.voucherTop}><View style={styles.voucherType}><Icon name="tag" size={15} color={colors.teal} /><Text style={styles.voucherTypeText}>Miles voucher</Text></View><View style={styles.voucherPrice}><MilesAmount amount={voucher.milesCost} size="sm" />{gap === 0 ? <Text style={styles.withinBalance}>Within your balance</Text> : gap != null ? <View style={styles.milesGapRow}><MilesAmount amount={gap} color={colors.muted} size="sm" /><Text style={styles.milesGap}>to go</Text></View> : null}</View></View>
      <Text style={styles.voucherValue}>{value}</Text><Text style={styles.voucherTitle}>{voucher.title}</Text><Text style={styles.voucherAvailability}>Available at participating branches</Text>
      <Pressable onPress={() => router.push({ pathname: '/vouchers/purchase/[templateId]', params: { templateId: voucher.id, title: voucher.title, merchantName, milesCost: String(voucher.milesCost) } })} style={styles.getVoucher}><Text style={styles.getVoucherText}>Get voucher</Text></Pressable>
    </View>
  );
}

function LocationsPanel({ locations }: { locations: MerchantLocation[] }) {
  return <View style={styles.panel}><PanelHeading title={locations.length === 1 ? 'Visit us' : 'Branches'} description="Opening hours, contact details and directions." count={`${locations.length} ${locations.length === 1 ? 'location' : 'locations'}`} />{locations.map((location) => <BranchCard key={location.id} location={location} />)}</View>;
}

function BranchCard({ location }: { location: MerchantLocation }) {
  const hours = todayHours(location);
  return (
    <View style={styles.branchCard}><View style={styles.branchTitleRow}><Text style={styles.branchName}>{location.name}</Text>{hours.open != null ? <Pill label={hours.open ? 'Open now' : 'Closed'} tone={hours.open ? 'teal' : 'neutral'} /> : null}</View><View style={styles.addressRow}><Icon name="map-pin" size={14} color={colors.muted} /><Text style={styles.address}>{formatAddress(location)}{location.landmark ? `\nNear ${location.landmark}` : ''}</Text></View><Text style={styles.hours}>{hours.label}</Text><View style={styles.branchActions}><SmallAction icon="navigation" label="Directions" onPress={() => Linking.openURL(directionsUrl(location))} />{location.publicPhone ? <SmallAction icon="phone" label="Call" onPress={() => Linking.openURL(`tel:${location.publicPhone}`)} /> : null}{location.publicWhatsapp ? <SmallAction icon="message-circle" label="WhatsApp" onPress={() => Linking.openURL(`https://wa.me/${location.publicWhatsapp?.replace(/[^\d]/g, '')}`)} /> : null}</View><View style={styles.chipRow}>{location.acceptsAkibaPass ? <Pill label="Accepts Akiba Pass" /> : null}{location.acceptsVouchers ? <Pill label="Accepts vouchers" /> : null}</View></View>
  );
}

function SmallAction({ icon, label, onPress }: { icon: 'navigation' | 'phone' | 'message-circle'; label: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.smallAction}><Icon name={icon} size={14} color={colors.ink} /><Text style={styles.smallActionText}>{label}</Text></Pressable>; }
function PanelHeading({ count, description, title }: { count: string; description: string; title: string }) { return <View style={styles.panelHeading}><View style={styles.flex}><Text style={styles.panelTitle}>{title}</Text><Text style={styles.panelDescription}>{description}</Text></View><Text style={styles.panelCount}>{count}</Text></View>; }
function EmptyPanel({ body, icon, title }: { body: string; icon: 'check-circle' | 'shopping-bag' | 'tag'; title: string }) { return <View style={styles.emptyPanel}><View style={styles.emptyIcon}><Icon name={icon} size={28} color={colors.teal} /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text></View>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <View style={styles.errorState}><Icon name="shopping-bag" size={42} color={colors.line} /><Text style={styles.emptyTitle}>Merchant temporarily unavailable</Text><Text style={styles.emptyBody}>{message}</Text><Pressable onPress={onRetry} style={styles.retryButton}><Text style={styles.retryText}>Retry</Text></Pressable></View>; }

function memberVisitCopy(visit: NonNullable<MerchantStateDetail['verifiedVisit']>, merchantName: string) { if (visit.recommendation === 'recommended') return `You’d recommend ${merchantName}.`; if (visit.recommendation === 'not_recommended') return 'Your private feedback was saved.'; return 'Your verified visit details were saved.'; }
function directionsUrl(location: MerchantLocation) { if (location.mapsUrl) return location.mapsUrl; if (location.latitude != null && location.longitude != null) return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`; return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(location))}`; }
function formatAddress(location: MerchantLocation) { return [location.addressLine1, location.addressLine2, location.building, location.floorOrUnit, location.locality, location.city].filter(Boolean).join(', '); }
function todayHours(location: MerchantLocation): { label: string; open: boolean | null } { const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: location.timezone }).format(new Date()).toLowerCase() as keyof MerchantLocation['openingHours']; const ranges = location.openingHours[day]; if (!Array.isArray(ranges) || ranges.length === 0) return { label: location.openingHours.notes ?? 'Hours unavailable', open: null }; const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: location.timezone }).format(new Date()); const open = ranges.some((range) => time >= range.opens && time <= range.closes); return { label: `Today · ${ranges.map((range) => `${range.opens}–${range.closes}`).join(', ')}`, open }; }

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.paper }, page: { paddingBottom: 28 }, centered: { alignItems: 'center', justifyContent: 'center', minHeight: 420 }, flex: { flex: 1 },
  backButton: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 6, minHeight: 44, marginHorizontal: 16, marginTop: 4 }, backText: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14 }, pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  bannerWrap: { height: 136, position: 'relative' }, banner: { height: 112, width: '100%' }, bannerLogo: { bottom: 0, left: 16, position: 'absolute' },
  logoWell: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.paper, borderCurve: 'continuous', borderRadius: 16, borderWidth: 4, height: 64, justifyContent: 'center', overflow: 'hidden', padding: 7, width: 64 }, inlineLogo: { borderColor: colors.line, borderWidth: 1, height: 80, width: 80 }, logoImage: { height: '100%', width: '100%' },
  identity: { paddingBottom: 12, paddingHorizontal: 16 }, identityRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 }, identityBody: { flex: 1, minWidth: 0 }, nameRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 }, merchantName: { color: colors.ink, flex: 1, fontFamily: fontFamily.sterlingSemiBold, fontSize: 22, lineHeight: 26 }, saveButton: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 999, borderWidth: 1, height: 36, justifyContent: 'center', width: 36 }, saveButtonActive: { backgroundColor: colors.tint, borderColor: colors.teal }, shortDescription: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 19, marginTop: 4 }, chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }, pill: { backgroundColor: colors.card, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }, pillTeal: { backgroundColor: colors.tint }, pillText: { color: colors.muted, fontFamily: fontFamily.sansMedium, fontSize: 11 }, pillTextTeal: { color: colors.teal, fontFamily: fontFamily.sansSemiBold },
  disclosure: { marginTop: 10 }, description: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 13, lineHeight: 20 }, offerings: { marginTop: 10 }, microHeading: { color: colors.muted, fontFamily: fontFamily.sansSemiBold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }, seeMore: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 3, minHeight: 36 }, seeMoreText: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 12 },
  actionRow: { gap: 8, paddingTop: 10 }, action: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 6, minHeight: 40, paddingHorizontal: 16 }, actionPrimary: { backgroundColor: colors.ink, borderColor: colors.ink }, actionCompact: { height: 40, justifyContent: 'center', paddingHorizontal: 0, width: 40 }, actionText: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 14 }, actionTextPrimary: { color: colors.white },
  tabs: { backgroundColor: 'rgba(252,252,252,0.96)', borderBottomColor: colors.line, borderBottomWidth: 1, borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row' }, tab: { alignItems: 'center', flex: 1, gap: 4, justifyContent: 'center', minHeight: 58, position: 'relative' }, tabPressed: { backgroundColor: colors.card }, tabText: { color: colors.muted, fontFamily: fontFamily.sansSemiBold, fontSize: 11 }, tabTextActive: { color: colors.ink }, tabIndicator: { backgroundColor: 'transparent', bottom: -1, height: 2, left: 8, position: 'absolute', right: 8 }, tabIndicatorActive: { backgroundColor: colors.teal },
  panel: { gap: 12, padding: 16 }, contributionCard: { alignItems: 'flex-start', backgroundColor: colors.tint, borderColor: 'rgba(35,141,157,0.20)', borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 14 }, privateVisit: { alignItems: 'flex-start', backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 16 }, roundIcon: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 999, height: 40, justifyContent: 'center', width: 40 }, roundIconTint: { alignItems: 'center', backgroundColor: colors.tint, borderRadius: 999, height: 40, justifyContent: 'center', width: 40 }, cardTitle: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 14 }, cardBody: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 13, lineHeight: 19, marginTop: 3 }, privateBadge: { alignSelf: 'flex-start', backgroundColor: colors.card, borderRadius: 999, color: colors.muted, fontFamily: fontFamily.sansSemiBold, fontSize: 10, marginTop: 4, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 2 },
  visitCard: { backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 22, borderWidth: 1, height: 224, overflow: 'hidden', position: 'relative' }, visitFallback: { backgroundColor: colors.tint }, verifiedVisitBadge: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999, flexDirection: 'row', gap: 6, left: 12, paddingHorizontal: 10, paddingVertical: 6, position: 'absolute', top: 12 }, verifiedVisitBadgeLight: { backgroundColor: 'rgba(255,255,255,0.82)' }, verifiedVisitBadgeText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 11 }, verifiedVisitBadgeTextDark: { color: colors.teal }, visitCardBottom: { bottom: 0, left: 0, padding: 16, position: 'absolute', right: 0 }, visitTitle: { color: colors.white, fontFamily: fontFamily.sterlingSemiBold, fontSize: 19, lineHeight: 23 }, visitTitleDark: { color: colors.ink }, visitHint: { color: 'rgba(255,255,255,0.75)', fontFamily: fontFamily.sans, fontSize: 12, marginTop: 4 }, visitHintDark: { color: colors.muted },
  modalScrim: { backgroundColor: 'rgba(0,0,0,0.70)', flex: 1, justifyContent: 'flex-end' }, visitModal: { backgroundColor: colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '94%', overflow: 'hidden' }, modalPhoto: { backgroundColor: colors.ink, height: 390, width: '100%' }, modalPhotoFallback: { alignItems: 'center', backgroundColor: colors.tint, height: 220, justifyContent: 'center' }, modalClose: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 999, height: 44, justifyContent: 'center', position: 'absolute', right: 12, top: 12, width: 44 }, photoNav: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', marginTop: -54 }, photoNavButton: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.60)', borderRadius: 999, height: 40, justifyContent: 'center', width: 40 }, photoCount: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 12, marginHorizontal: 12 }, modalCopy: { gap: 10, paddingHorizontal: 20, paddingTop: 24 }, modalEyebrow: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' }, modalTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 24, lineHeight: 29 }, modalFootnote: { borderTopColor: colors.line, borderTopWidth: 1, color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 18, marginTop: 10, paddingTop: 14 },
  businessPanel: { paddingBottom: 16 }, panelIntro: { alignItems: 'flex-start', flexDirection: 'row', gap: 16, justifyContent: 'space-between', padding: 16 }, panelIntroText: { color: colors.muted, flex: 1, fontFamily: fontFamily.sans, fontSize: 13, lineHeight: 19 }, panelCount: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 12 }, photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 1 }, gridPhotoButton: { aspectRatio: 1, backgroundColor: colors.card, flexBasis: '33%', flexGrow: 1, maxWidth: '33.2%', position: 'relative' }, galleryModal: { backgroundColor: '#000', flex: 1 }, galleryHeader: { alignItems: 'center', borderBottomColor: 'rgba(255,255,255,0.10)', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 16, paddingTop: 54 }, galleryMerchant: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 16 }, gallerySource: { color: 'rgba(255,255,255,0.65)', fontFamily: fontFamily.sans, fontSize: 12 }, galleryClose: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 }, galleryImage: { flex: 1, width: '100%' }, galleryCaption: { color: colors.white, fontFamily: fontFamily.sans, fontSize: 14, padding: 18, textAlign: 'center' },
  panelHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 }, panelTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 19 }, panelDescription: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 19, marginTop: 3 }, emptyPanel: { alignItems: 'center', borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, padding: 34 }, emptyIcon: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 999, borderWidth: 1, height: 56, justifyContent: 'center', width: 56 }, emptyTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 19, marginTop: 12, textAlign: 'center' }, emptyBody: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20, marginTop: 4, textAlign: 'center' },
  voucherCard: { backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, padding: 16 }, voucherTop: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' }, voucherType: { alignItems: 'center', flexDirection: 'row', gap: 6 }, voucherTypeText: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 12 }, voucherPrice: { alignItems: 'flex-end' }, withinBalance: { color: colors.teal, fontFamily: fontFamily.sansMedium, fontSize: 10, marginTop: 3 }, milesGapRow: { alignItems: 'center', flexDirection: 'row', gap: 3, marginTop: 3 }, milesGap: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 10 }, voucherValue: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 21, marginTop: 20 }, voucherTitle: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 14, marginTop: 8 }, voucherAvailability: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, marginTop: 4 }, getVoucher: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 999, marginTop: 20, minHeight: 44, justifyContent: 'center' }, getVoucherText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
  branchCard: { backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, padding: 16 }, branchTitleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 8, justifyContent: 'space-between' }, branchName: { color: colors.ink, flex: 1, fontFamily: fontFamily.sansSemiBold, fontSize: 16 }, addressRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 6, marginTop: 6 }, address: { color: colors.muted, flex: 1, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 19 }, hours: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, marginTop: 6 }, branchActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }, smallAction: { alignItems: 'center', borderColor: colors.line, borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 6, minHeight: 44, paddingHorizontal: 14 }, smallActionText: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 12 },
  errorState: { alignItems: 'center', margin: 16, padding: 40 }, retryButton: { backgroundColor: colors.teal, borderRadius: 999, marginTop: 16, paddingHorizontal: 20, paddingVertical: 11 }, retryText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
});
