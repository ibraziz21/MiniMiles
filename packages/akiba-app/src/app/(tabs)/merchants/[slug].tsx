// GET /api/v1/merchants/:slug + private merchant-state overlay. This is a
// native translation of hub-page's current merchant profile, not a separate
// mobile information architecture.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, Linking, Modal, Pressable, ScrollView as HorizontalScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import { FundedOfferCard } from '@/components/funded-offer-card';
import { MilesAmount } from '@/components/miles-amount';
import { VerifiedVisitCommunity } from '@/components/verified-visit-community';
import type {
  CustomerPhoto,
  MerchantDetail,
  MerchantLocation,
  MerchantMedia,
  MerchantOffer,
  MerchantStateDetail,
  PublicVoucherSummary,
  VerifiedVisit,
} from '@/contracts';
import { ActivityIndicator, Icon, ScrollView, colors, fontFamily } from '@/design-system';
import { merchantOfferAvailability } from '@/lib/merchant-offer-availability';

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
  const [helpfulVisitIds, setHelpfulVisitIds] = useState<Set<string>>(() => new Set());

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
      setHelpfulVisitIds(new Set(overlay?.helpfulVisitIds ?? []));
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong' });
    }
  }, [accessToken, slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const toggleSave = useCallback(async () => {
    if (!accessToken) {
      Alert.alert('Sign in required', 'Sign in to save this merchant.');
      return;
    }
    if (savePending) return;
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

  const toggleHelpful = useCallback(async (visitId: string) => {
    if (!accessToken) {
      Alert.alert('Sign in required', 'Sign in to mark a verified visit as helpful.');
      return;
    }

    const previous = helpfulVisitIds.has(visitId);
    setHelpfulVisitIds((current) => {
      const updated = new Set(current);
      if (previous) updated.delete(visitId);
      else updated.add(visitId);
      return updated;
    });
    try {
      const client = createApiClient({ accessToken });
      if (previous) await client.unmarkVerifiedVisitHelpful(slug, visitId);
      else await client.markVerifiedVisitHelpful(slug, visitId);
    } catch {
      setHelpfulVisitIds((current) => {
        const updated = new Set(current);
        if (previous) updated.add(visitId);
        else updated.delete(visitId);
        return updated;
      });
      Alert.alert('Could not update Helpful', 'Please try again.');
    }
  }, [accessToken, helpfulVisitIds, slug]);

  const refreshVisitPhoto = useCallback(async (photoId: string, updateProfile = true): Promise<CustomerPhoto | null> => {
    try {
      const detail = await createApiClient().getMerchantDetail(slug, { freshPhotos: true });
      if (updateProfile) {
        setState((current) => current.status === 'ready' ? { ...current, detail } : current);
      }
      return detail.merchant.approvedCustomerPhotos.find((photo) => photo.id === photoId)
        ?? detail.merchant.verifiedVisits.flatMap((visit) => visit.photos).find((photo) => photo.id === photoId)
        ?? null;
    } catch {
      return null;
    }
  }, [slug]);

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
            helpfulVisitIds={helpfulVisitIds}
            onToggleSave={toggleSave}
            onToggleHelpful={toggleHelpful}
            overlay={state.overlay}
            refreshVisitPhoto={refreshVisitPhoto}
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
  helpfulVisitIds,
  onToggleHelpful,
  onToggleSave,
  overlay,
  refreshVisitPhoto,
  savePending,
  saved,
}: {
  detail: MerchantDetail;
  helpfulVisitIds: Set<string>;
  onToggleHelpful: (visitId: string) => Promise<void>;
  onToggleSave: () => void;
  overlay: MerchantStateDetail | null;
  refreshVisitPhoto: (photoId: string, updateProfile?: boolean) => Promise<CustomerPhoto | null>;
  savePending: boolean;
  saved: boolean;
}) {
  const { merchant, vouchers, fundedOffers } = detail;
  const claimedIds = useMemo(() => new Set(overlay?.claimedFundedAllocationIds ?? []), [overlay?.claimedFundedAllocationIds]);
  const totalOffers = merchant.offers.length + vouchers.length + fundedOffers.length;
  const defaultTab: ProfileTab = totalOffers > 0
    ? 'vouchers'
    : overlay?.verifiedVisit || merchant.verifiedVisits.length > 0
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
        <VerifiedPanel
          favoriteProduct={merchant.verifiedVisitFavoriteProduct}
          helpfulVisitIds={helpfulVisitIds}
          merchantName={merchant.name}
          merchantSlug={merchant.slug}
          onToggleHelpful={onToggleHelpful}
          onToggleSave={onToggleSave}
          overlay={overlay}
          refreshVisitPhoto={refreshVisitPhoto}
          savePending={savePending}
          saved={saved}
          visits={merchant.verifiedVisits}
        />
      ) : activeTab === 'merchant' ? (
        <BusinessGallery merchantName={merchant.name} media={merchant.merchantMedia} />
      ) : activeTab === 'vouchers' ? (
        <OffersPanel
          businessOffers={merchant.offers}
          merchantName={merchant.name}
          vouchers={vouchers}
          fundedOffers={fundedOffers}
          claimedIds={claimedIds}
          initialReminderIds={new Set(overlay?.offerReminderIds ?? [])}
          balance={overlay?.balance ?? null}
        />
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
    vouchers: { label: 'Offers', icon: 'tag' as const },
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

function VerifiedPanel({
  favoriteProduct,
  helpfulVisitIds,
  merchantName,
  merchantSlug,
  onToggleHelpful,
  onToggleSave,
  overlay,
  refreshVisitPhoto,
  savePending,
  saved,
  visits,
}: {
  favoriteProduct: string | null;
  helpfulVisitIds: Set<string>;
  merchantName: string;
  merchantSlug: string;
  onToggleHelpful: (visitId: string) => Promise<void>;
  onToggleSave: () => void;
  overlay: MerchantStateDetail | null;
  refreshVisitPhoto: (photoId: string, updateProfile?: boolean) => Promise<CustomerPhoto | null>;
  savePending: boolean;
  saved: boolean;
  visits: VerifiedVisit[];
}) {
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
      <VerifiedVisitCommunity
        favoriteProduct={favoriteProduct}
        helpfulVisitIds={helpfulVisitIds}
        merchantName={merchantName}
        merchantSlug={merchantSlug}
        onToggleHelpful={onToggleHelpful}
        onToggleSave={onToggleSave}
        refreshVisitPhoto={refreshVisitPhoto}
        savePending={savePending}
        saved={saved}
        visits={visits}
      />
    </View>
  );
}

function BusinessGallery({ media, merchantName }: { media: MerchantMedia[]; merchantName: string }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex == null ? null : media[selectedIndex];
  return (
    <View style={styles.businessPanel}>
      {media.length === 0 ? <EmptyPanel icon="shopping-bag" title="No business photos yet" body={`${merchantName} has not added photos to this gallery yet.`} /> : <View style={styles.photoGrid}>{media.map((photo, index) => <Pressable key={photo.id} onPress={() => setSelectedIndex(index)} style={styles.gridPhotoButton}><Image source={{ uri: photo.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={140} /></Pressable>)}</View>}
      <Modal animationType="fade" onRequestClose={() => setSelectedIndex(null)} visible={Boolean(selected)}>
        <View style={styles.galleryModal}><View style={styles.galleryHeader}><View><Text style={styles.galleryMerchant}>{merchantName}</Text><Text style={styles.gallerySource}>From the business</Text></View><Pressable onPress={() => setSelectedIndex(null)} style={styles.galleryClose}><Icon name="x" size={24} color={colors.white} /></Pressable></View>{selected ? <Image source={{ uri: selected.imageUrl }} style={styles.galleryImage} contentFit="contain" /> : null}{selected && selectedIndex != null ? <Text style={styles.galleryCaption}>{selected.title ?? selected.altText}  {selectedIndex + 1} of {media.length}</Text> : null}</View>
      </Modal>
    </View>
  );
}

function OffersPanel({ balance, businessOffers, claimedIds, fundedOffers, initialReminderIds, merchantName, vouchers }: { balance: number | null; businessOffers: MerchantOffer[]; claimedIds: Set<string>; fundedOffers: MerchantDetail['fundedOffers']; initialReminderIds: Set<string>; merchantName: string; vouchers: PublicVoucherSummary[] }) {
  const [filter, setFilter] = useState<'all' | 'business' | 'akiba'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const rewardCount = vouchers.length + fundedOffers.length;
  const count = businessOffers.length + rewardCount;
  const showBusiness = filter !== 'akiba';
  const showRewards = filter !== 'business';
  const filters = [
    { id: 'all' as const, label: 'All', count },
    { id: 'business' as const, label: 'Business offers', count: businessOffers.length },
    { id: 'akiba' as const, label: 'Akiba rewards', count: rewardCount },
  ];
  const showBusinessGroup = showBusiness && (businessOffers.length > 0 || filter === 'business');
  const showRewardsGroup = showRewards && (rewardCount > 0 || filter === 'akiba');
  const showGroupLabels = filter === 'all' && businessOffers.length > 0 && rewardCount > 0;

  return (
    <View style={styles.panel}>
      <View style={styles.offerToolbar}>
        <Text style={styles.panelTitle}>Offers</Text>
        <Text style={styles.offerCount}>{count}</Text>
        {count > 0 ? (
          <Pressable
            accessibilityLabel={filter === 'all' ? 'Filter offers' : `Filter offers: ${filters.find((item) => item.id === filter)?.label}`}
            accessibilityRole="button"
            onPress={() => setFilterOpen(true)}
            style={({ pressed }) => [styles.offerFilterButton, filter !== 'all' && styles.offerFilterButtonActive, pressed && styles.pressed]}>
            <Icon name="sliders" size={18} color={filter === 'all' ? colors.ink : colors.white} />
            {filter !== 'all' ? <View style={styles.offerFilterDot} /> : null}
          </Pressable>
        ) : null}
      </View>
      {count === 0 ? <EmptyPanel icon="tag" title="No offers right now" body="Check back later." /> : (
        <>
          {showBusinessGroup ? (
            <View style={styles.offerGroup}>
              {showGroupLabels ? <Text style={styles.offerGroupTitle}>From {merchantName}</Text> : null}
              {businessOffers.length > 0
                ? businessOffers.map((offer) => <BusinessOfferCard key={offer.id} initialReminderSet={initialReminderIds.has(offer.id) || offer.reminderSet} offer={offer} />)
                : <InlineEmpty text="No direct offers right now." />}
            </View>
          ) : null}

          {showRewardsGroup ? (
            <View style={[styles.offerGroup, showBusinessGroup && businessOffers.length > 0 && styles.offerGroupSeparated]}>
              {showGroupLabels ? <Text style={styles.offerGroupTitle}>Akiba rewards</Text> : null}
              {rewardCount > 0 ? (
                <>
                  {fundedOffers.map((offer) => <FundedOfferCard key={offer.allocationId} offer={offer} claimed={claimedIds.has(offer.allocationId)} />)}
                  {vouchers.map((voucher) => <MerchantVoucher key={voucher.id} balance={balance} merchantName={merchantName} voucher={voucher} />)}
                </>
              ) : <InlineEmpty text="No Akiba rewards right now." />}
            </View>
          ) : null}
        </>
      )}
      <Modal animationType="fade" onRequestClose={() => setFilterOpen(false)} transparent visible={filterOpen}>
        <View accessibilityViewIsModal style={styles.filterModal}>
          <Pressable accessibilityLabel="Close offer filters" onPress={() => setFilterOpen(false)} style={StyleSheet.absoluteFill} />
          <View style={styles.filterSheet}>
            <View style={styles.filterSheetHeader}>
              <Text style={styles.filterSheetTitle}>Show</Text>
              <Pressable accessibilityLabel="Close" hitSlop={8} onPress={() => setFilterOpen(false)} style={styles.filterSheetClose}>
                <Icon name="x" size={19} color={colors.ink} />
              </Pressable>
            </View>
            {filters.map((item) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: filter === item.id }}
                key={item.id}
                onPress={() => { setFilter(item.id); setFilterOpen(false); }}
                style={({ pressed }) => [styles.filterOption, pressed && styles.pressed]}>
                <Text style={styles.filterOptionLabel}>{item.label}</Text>
                <Text style={styles.filterOptionCount}>{item.count}</Text>
                <Icon name="check" size={18} color={filter === item.id ? colors.teal : 'transparent'} />
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function BusinessOfferCard({ initialReminderSet, offer }: { initialReminderSet: boolean; offer: MerchantOffer }) {
  const { accessToken } = useAuth();
  const availability = merchantOfferAvailability(offer);
  const [termsExpanded, setTermsExpanded] = useState(false);
  const [reminderSet, setReminderSet] = useState(initialReminderSet);
  const [reminderPending, setReminderPending] = useState(false);

  async function saveReminder(leadMinutes: 30 | 60 | 1440) {
    if (!accessToken) {
      Alert.alert('Sign in required', 'Sign in to save an offer reminder.');
      return;
    }
    setReminderPending(true);
    try {
      await createApiClient({ accessToken }).setOfferReminder(offer.id, leadMinutes);
      setReminderSet(true);
    } catch (error) {
      Alert.alert('Reminder not saved', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setReminderPending(false);
    }
  }

  async function removeReminder() {
    if (!accessToken) return;
    setReminderPending(true);
    try {
      await createApiClient({ accessToken }).removeOfferReminder(offer.id);
      setReminderSet(false);
    } catch (error) {
      Alert.alert('Reminder not removed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setReminderPending(false);
    }
  }

  function chooseReminder() {
    if (!accessToken) {
      Alert.alert('Sign in required', 'Sign in to save an offer reminder.');
      return;
    }
    Alert.alert(
      reminderSet ? 'Change reminder' : 'Save a reminder',
      'Choose when to be reminded.',
      [
        { text: '30 minutes before', onPress: () => void saveReminder(30) },
        { text: '1 hour before', onPress: () => void saveReminder(60) },
        { text: '1 day before', onPress: () => void saveReminder(1440) },
        ...(reminderSet ? [{ text: 'Remove reminder', style: 'destructive' as const, onPress: () => void removeReminder() }] : []),
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  return (
    <View style={styles.businessOfferCard}>
      {offer.imageUrl ? <Image accessibilityLabel="" source={{ uri: offer.imageUrl }} style={styles.businessOfferImage} contentFit="cover" transition={160} /> : null}
      <View style={styles.businessOfferBody}>
        <Text style={styles.businessOfferSourceText}>Direct offer · No AkibaMiles</Text>
        <Text style={styles.businessOfferTitle}>{offer.title}</Text>
        <Text numberOfLines={3} style={styles.businessOfferDescription}>{offer.description}</Text>
        <Text style={styles.businessOfferScheduleText}>
          <Text style={[styles.businessOfferStatus, availability.state === 'available' && styles.businessOfferStatusAvailable]}>{availability.label}</Text>
          {'  ·  '}{availability.scheduleLabel}
        </Text>
        {offer.terms ? (
          <View style={styles.offerTerms}>
            <Pressable onPress={() => setTermsExpanded((current) => !current)} style={styles.offerTermsButton}><Text style={styles.offerTermsButtonText}>Terms</Text><Icon name="chevron-down" size={15} color={colors.ink} /></Pressable>
            {termsExpanded ? <Text style={styles.offerTermsText}>{offer.terms}</Text> : null}
          </View>
        ) : null}
        {offer.remindersEnabled && availability.state !== 'ended' ? (
          <View style={styles.reminderArea}>
            <Pressable accessibilityState={{ busy: reminderPending, selected: reminderSet }} disabled={reminderPending} onPress={chooseReminder} style={[styles.reminderButton, reminderSet && styles.reminderButtonActive]}>
              {reminderPending ? <ActivityIndicator color={colors.teal} size="small" /> : <Icon name="bell" size={16} color={reminderSet ? colors.teal : colors.ink} />}
              <Text style={[styles.reminderButtonText, reminderSet && styles.reminderButtonTextActive]}>{reminderSet ? 'Reminder saved' : 'Save reminder'}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function InlineEmpty({ text }: { text: string }) {
  return <View style={styles.inlineEmpty}><Text style={styles.inlineEmptyText}>{text}</Text></View>;
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
  businessPanel: { paddingBottom: 16 }, panelIntro: { alignItems: 'flex-start', flexDirection: 'row', gap: 16, justifyContent: 'space-between', padding: 16 }, panelIntroText: { color: colors.muted, flex: 1, fontFamily: fontFamily.sans, fontSize: 13, lineHeight: 19 }, panelCount: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 12 }, photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 1 }, gridPhotoButton: { aspectRatio: 1, backgroundColor: colors.card, flexBasis: '33%', flexGrow: 1, maxWidth: '33.2%', position: 'relative' }, galleryModal: { backgroundColor: '#000', flex: 1 }, galleryHeader: { alignItems: 'center', borderBottomColor: 'rgba(255,255,255,0.10)', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 16, paddingTop: 54 }, galleryMerchant: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 16 }, gallerySource: { color: 'rgba(255,255,255,0.65)', fontFamily: fontFamily.sans, fontSize: 12 }, galleryClose: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 }, galleryImage: { flex: 1, width: '100%' }, galleryCaption: { color: colors.white, fontFamily: fontFamily.sans, fontSize: 14, padding: 18, textAlign: 'center' },
  panelHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 }, panelTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 19 }, panelDescription: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 19, marginTop: 3 }, emptyPanel: { alignItems: 'center', borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, padding: 28 }, emptyIcon: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 999, borderWidth: 1, height: 48, justifyContent: 'center', width: 48 }, emptyTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 19, marginTop: 10, textAlign: 'center' }, emptyBody: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20, marginTop: 3, textAlign: 'center' },
  offerToolbar: { alignItems: 'center', flexDirection: 'row', minHeight: 44 }, offerCount: { color: colors.muted, fontFamily: fontFamily.sansSemiBold, fontSize: 12, marginLeft: 'auto', marginRight: 10 }, offerFilterButton: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 999, borderWidth: 1, height: 44, justifyContent: 'center', position: 'relative', width: 44 }, offerFilterButtonActive: { backgroundColor: colors.ink, borderColor: colors.ink }, offerFilterDot: { backgroundColor: colors.teal, borderRadius: 999, height: 6, position: 'absolute', right: 7, top: 7, width: 6 },
  filterModal: { backgroundColor: 'rgba(8,12,15,0.40)', flex: 1, justifyContent: 'flex-end' }, filterSheet: { backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 28, paddingHorizontal: 16, paddingTop: 12 }, filterSheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 44 }, filterSheetTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 20 }, filterSheetClose: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 }, filterOption: { alignItems: 'center', borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', minHeight: 52 }, filterOptionLabel: { color: colors.ink, flex: 1, fontFamily: fontFamily.sansMedium, fontSize: 15 }, filterOptionCount: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 13, marginRight: 12 },
  offerGroup: { gap: 10 }, offerGroupSeparated: { borderTopColor: colors.line, borderTopWidth: 1, marginTop: 10, paddingTop: 18 }, offerGroupTitle: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 14 }, inlineEmpty: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, padding: 24 }, inlineEmptyText: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 13, textAlign: 'center' },
  businessOfferCard: { backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 18, borderWidth: 1, overflow: 'hidden' }, businessOfferImage: { aspectRatio: 16 / 9, backgroundColor: colors.card, width: '100%' }, businessOfferBody: { padding: 16 }, businessOfferSourceText: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 12 }, businessOfferTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 21, lineHeight: 26, marginTop: 8 }, businessOfferDescription: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20, marginTop: 5 }, businessOfferStatus: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 12 }, businessOfferStatusAvailable: { color: colors.teal }, businessOfferScheduleText: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 18, marginTop: 11 }, offerTerms: { marginTop: 9 }, offerTermsButton: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 5, minHeight: 36 }, offerTermsButtonText: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 12 }, offerTermsText: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 19, marginTop: 3 }, reminderArea: { alignItems: 'flex-start', marginTop: 13 }, reminderButton: { alignItems: 'center', borderColor: colors.line, borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 44, paddingHorizontal: 16 }, reminderButtonActive: { backgroundColor: colors.tint, borderColor: colors.tint }, reminderButtonText: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 13 }, reminderButtonTextActive: { color: colors.teal },
  voucherCard: { backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, padding: 16 }, voucherTop: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' }, voucherType: { alignItems: 'center', flexDirection: 'row', gap: 6 }, voucherTypeText: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 12 }, voucherPrice: { alignItems: 'flex-end' }, withinBalance: { color: colors.teal, fontFamily: fontFamily.sansMedium, fontSize: 10, marginTop: 3 }, milesGapRow: { alignItems: 'center', flexDirection: 'row', gap: 3, marginTop: 3 }, milesGap: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 10 }, voucherValue: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 21, marginTop: 20 }, voucherTitle: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 14, marginTop: 8 }, voucherAvailability: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, marginTop: 4 }, getVoucher: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 999, marginTop: 20, minHeight: 44, justifyContent: 'center' }, getVoucherText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
  branchCard: { backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, padding: 16 }, branchTitleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 8, justifyContent: 'space-between' }, branchName: { color: colors.ink, flex: 1, fontFamily: fontFamily.sansSemiBold, fontSize: 16 }, addressRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 6, marginTop: 6 }, address: { color: colors.muted, flex: 1, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 19 }, hours: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, marginTop: 6 }, branchActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }, smallAction: { alignItems: 'center', borderColor: colors.line, borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 6, minHeight: 44, paddingHorizontal: 14 }, smallActionText: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 12 },
  errorState: { alignItems: 'center', margin: 16, padding: 40 }, retryButton: { backgroundColor: colors.teal, borderRadius: 999, marginTop: 16, paddingHorizontal: 20, paddingVertical: 11 }, retryText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
});
