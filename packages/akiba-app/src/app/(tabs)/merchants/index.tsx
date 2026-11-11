// GET /api/v1/merchants — native port of hub-page's directory surface.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createApiClient } from '@/api';
import { DiscoveryToolbar } from '@/components/discovery-toolbar';
import { MilesBalanceButton } from '@/components/miles-balance-button';
import { MerchantDirectoryCard } from '@/components/merchant-card';
import type { MerchantValueSummary } from '@/contracts';
import { ActivityIndicator, FlatList, Icon, colors, fontFamily } from '@/design-system';

type Mode = 'all' | 'physical' | 'online';
type Coordinates = { lat: number; lng: number };
type Filters = { q: string; category: string; city: string; mode: Mode; hasOffer: boolean };

const EMPTY_FILTERS: Filters = { q: '', category: '', city: '', mode: 'all', hasOffer: false };

export default function MerchantsScreen() {
  const params = useLocalSearchParams<{ filterRequest?: string; q?: string }>();
  const { width } = useWindowDimensions();
  const initialQuery = typeof params.q === 'string' ? params.q : '';
  const columns = width >= 720 ? 2 : 1;
  const horizontalGutter = width >= 768 ? 24 : 16;
  const requestVersion = useRef(0);
  const lastExternalQuery = useRef(initialQuery);
  const lastFilterRequest = useRef(params.filterRequest);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, q: initialQuery });
  const [nearMe, setNearMe] = useState<Coordinates | null>(null);
  const [merchants, setMerchants] = useState<MerchantValueSummary[]>([]);
  const [knownPlaces, setKnownPlaces] = useState<MerchantValueSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState(false);
  const allCategories = useMemo(() => Array.from(new Map(
    knownPlaces.flatMap((place) => place.primaryCategory ? [[place.primaryCategory.slug, place.primaryCategory] as const] : []),
  ).values()).sort((a, b) => a.name.localeCompare(b.name)), [knownPlaces]);
  const allCities = useMemo(() => [...new Set(knownPlaces.flatMap((place) => place.nearestLocation?.city ? [place.nearestLocation.city] : []))].sort(), [knownPlaces]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(Boolean(params.filterRequest));

  const load = useCallback(async (nextFilters: Filters, coordinates: Coordinates | null, cursor?: string) => {
    const version = ++requestVersion.current;
    if (cursor) {
      setLoadingMore(true);
      setPageError(false);
    } else {
      setLoading(true);
      setLoadingMore(false);
      setError(null);
      setPageError(false);
      setNextCursor(null);
    }
    try {
      const data = await createApiClient().getMerchants({
        q: nextFilters.q.trim() || undefined,
        category: nextFilters.category || undefined,
        city: nextFilters.city || undefined,
        mode: nextFilters.mode,
        lat: coordinates?.lat,
        lng: coordinates?.lng,
        radius_km: coordinates ? 25 : undefined,
        cursor,
      });
      if (version !== requestVersion.current) return;
      setMerchants((current) => cursor
        ? [...new Map([...current, ...data.merchants].map((place) => [place.id, place])).values()]
        : data.merchants);
      setKnownPlaces((current) => [...new Map([...current, ...data.merchants].map((place) => [place.id, place])).values()]);
      setNextCursor(data.next_cursor);
    } catch (loadError) {
      if (version !== requestVersion.current) return;
      if (cursor) setPageError(true);
      else {
        setMerchants([]);
        setError(loadError instanceof Error ? loadError.message : 'Something went wrong');
      }
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  const invalidateRequest = useCallback(() => { requestVersion.current++; }, []);
  const { q, category, city, mode } = filters;
  useEffect(() => {
    const handle = setTimeout(() => void load({ ...EMPTY_FILTERS, q, category, city, mode }, nearMe), q ? 250 : 0);
    return () => {
      clearTimeout(handle);
      invalidateRequest();
    };
  }, [q, category, city, mode, invalidateRequest, load, nearMe]);

  useEffect(() => {
    if (!initialQuery) return;
    let cancelled = false;
    void createApiClient().getMerchants().then(({ merchants }) => {
      if (!cancelled) setKnownPlaces((current) => [...new Map([...current, ...merchants].map((place) => [place.id, place])).values()]);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [initialQuery]);

  useEffect(() => {
    if (params.filterRequest && params.filterRequest !== lastFilterRequest.current) {
      lastFilterRequest.current = params.filterRequest;
      setFiltersOpen(true);
    }
  }, [params.filterRequest]);

  useEffect(() => {
    if (typeof params.q === 'string' && params.q !== lastExternalQuery.current) {
      lastExternalQuery.current = params.q;
      setFilters((current) => ({ ...current, q: params.q ?? '' }));
    }
  }, [params.q]);

  const visibleMerchants = useMemo(
    () => filters.hasOffer ? merchants.filter((merchant) => (merchant.voucherCount ?? 0) > 0) : merchants,
    [filters.hasOffer, merchants],
  );

  const activeFilterCount =
    (filters.mode !== 'all' ? 1 : 0) +
    (filters.city ? 1 : 0) +
    (filters.category ? 1 : 0) +
    (filters.hasOffer ? 1 : 0) +
    (nearMe ? 1 : 0);
  const appliedFilters: { label: string; remove: () => void }[] = [
    filters.city && { label: filters.city, remove: () => setFilters((current) => ({ ...current, city: '' })) },
    filters.mode !== 'all' && { label: filters.mode === 'physical' ? 'In store' : 'Online', remove: () => setFilters((current) => ({ ...current, mode: 'all' })) },
    filters.hasOffer && { label: 'Has an active offer', remove: () => setFilters((current) => ({ ...current, hasOffer: false })) },
    nearMe && { label: 'Near me', remove: () => setNearMe(null) },
  ].flatMap((filter) => filter ? [filter] : []);


  return (
    <View style={styles.screen}>
      <FlatList
        key={`merchant-columns-${columns}`}
        columnWrapperStyle={columns > 1 ? styles.columnRow : undefined}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.listContent, { paddingHorizontal: horizontalGutter }]}
        data={loading ? [] : visibleMerchants}
        keyExtractor={(merchant) => merchant.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <DirectoryHeader
            activeFilterCount={activeFilterCount}
            appliedFilters={appliedFilters}
            resultCount={loading || error ? undefined : visibleMerchants.length}
            hasMore={Boolean(nextCursor)}
            onOpenNearby={() => setFiltersOpen(true)}
            categories={allCategories}
            onChangeCategory={(category) => setFilters((current) => ({ ...current, category }))}
            filters={filters}
            onChangeQuery={(q) => setFilters((current) => ({ ...current, q }))}
            onOpenFilters={() => setFiltersOpen(true)}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingState}><ActivityIndicator color={colors.teal} /></View>
          ) : error ? (
            <EmptyState icon="wifi-off" title="Places are temporarily unavailable"><EmptyAction label="Retry" onPress={() => void load(filters, nearMe)} /></EmptyState>
          ) : nextCursor ? null : (
            <EmptyState icon="shopping-bag" title={filters.q || activeFilterCount ? 'No places match' : 'No places to show yet'}>
              {filters.q || activeFilterCount ? <Text style={styles.emptyBody}>Try broadening your search or clearing a filter.</Text> : null}
              {activeFilterCount > 0 ? <EmptyAction label="Clear filters" onPress={() => { setFilters((current) => ({ ...EMPTY_FILTERS, q: current.q })); setNearMe(null); }} /> : null}
              {filters.q ? <EmptyAction label="Clear search" onPress={() => setFilters((current) => ({ ...current, q: '' }))} /> : null}
            </EmptyState>
          )
        }
        ListFooterComponent={!loading && nextCursor ? (
          <View style={styles.footer}>
            {pageError ? <Text style={styles.resultText}>Couldn’t load more places.</Text> : null}
            {loadingMore ? <ActivityIndicator color={colors.teal} /> : (
              <EmptyAction label={pageError ? 'Try again' : 'Load more places'} onPress={() => void load(filters, nearMe, nextCursor)} />
            )}
          </View>
        ) : null}
        renderItem={({ item }) => (
          <View style={[styles.gridItem, columns > 1 && styles.gridItemWide]}><MerchantDirectoryCard merchant={item} onPress={() => router.push(`/merchants/${item.slug}`)} /></View>
        )}
        ItemSeparatorComponent={ItemSeparator}
        numColumns={columns}
      />

      {filtersOpen ? (
        <FiltersSheet
          categories={allCategories}
          cities={allCities}
          initialFilters={filters}
          initialNearMe={nearMe}
          onApply={(draft, coordinates) => {
            setFilters((current) => ({ ...draft, q: current.q }));
            setNearMe(coordinates);
            setFiltersOpen(false);
          }}
          onClose={() => setFiltersOpen(false)}
        />
      ) : null}
    </View>
  );
}

function DirectoryHeader({
  activeFilterCount,
  appliedFilters,
  resultCount,
  hasMore,
  onOpenNearby,
  categories,
  filters,
  onChangeCategory,
  onChangeQuery,
  onOpenFilters,
}: {
  activeFilterCount: number;
  appliedFilters: { label: string; remove: () => void }[];
  resultCount?: number;
  hasMore: boolean;
  onOpenNearby: () => void;
  categories: { slug: string; name: string }[];
  filters: Filters;
  onChangeCategory: (category: string) => void;
  onChangeQuery: (query: string) => void;
  onOpenFilters: () => void;
}) {
  return (
    <View style={styles.toolbarWrap}>
      <View style={styles.titleRow}>
        <View style={styles.titleCopy}>
          <Text accessibilityRole="header" style={styles.directoryTitle}>Places</Text>
          <Text style={styles.subtitle}>Find places to earn AkibaMiles and use rewards.</Text>
        </View>
        <MilesBalanceButton />
      </View>
      <DiscoveryToolbar showFilterLabel showProfile={false} activeFilterCount={activeFilterCount} onChangeText={onChangeQuery} onOpenFilters={onOpenFilters} value={filters.q} />
      {categories.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
          <FilterChip active={!filters.category} label="All places" onPress={() => onChangeCategory('')} />
          {categories.map((category) => <FilterChip key={category.slug} active={filters.category === category.slug} label={category.name} onPress={() => onChangeCategory(category.slug)} />)}
        </ScrollView>
      ) : null}
      {appliedFilters.length ? (
        <View style={styles.appliedRow}>
          {appliedFilters.map((filter) => (
            <Pressable key={filter.label} accessibilityRole="button" accessibilityLabel={`Remove filter: ${filter.label}`} onPress={filter.remove} style={styles.appliedChip}>
              <Text style={styles.appliedLabel}>{filter.label}</Text>
              <Icon name="x" size={14} color={colors.tealDark} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {resultCount != null ? (
        <View style={styles.resultStrip}>
          <Text accessibilityLiveRegion="polite" style={styles.resultText}>
            {resultCount === 0 && hasMore ? 'More places to browse' : `Showing ${resultCount} ${resultCount === 1 ? 'place' : 'places'}${filters.city ? ` in ${filters.city}` : ''}`}
          </Text>
          <Pressable accessibilityRole="button" onPress={onOpenNearby} style={styles.nearbyButton}>
            <Icon name="map-pin" size={15} color={colors.tealDark} />
            <Text style={styles.appliedLabel}>Nearby</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function FiltersSheet({
  categories,
  cities,
  initialFilters,
  initialNearMe,
  onApply,
  onClose,
}: {
  categories: { slug: string; name: string }[];
  cities: string[];
  initialFilters: Filters;
  initialNearMe: Coordinates | null;
  onApply: (filters: Filters, nearMe: Coordinates | null) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [filters, onChange] = useState(initialFilters);
  const [nearMe, setNearMe] = useState(initialNearMe);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'locating' | 'denied'>('idle');
  const locationRequest = useRef(0);

  async function onToggleNearMe() {
    const request = ++locationRequest.current;
    if (nearMe || locationStatus === 'locating') {
      setNearMe(null);
      setLocationStatus('idle');
      return;
    }
    setLocationStatus('locating');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      const position = permission.granted && request === locationRequest.current
        ? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        : null;
      if (request !== locationRequest.current) return;
      setNearMe(position ? { lat: position.coords.latitude, lng: position.coords.longitude } : null);
      setLocationStatus(position ? 'idle' : 'denied');
    } catch {
      if (request === locationRequest.current) setLocationStatus('denied');
    }
  }

  function onClearAll() {
    locationRequest.current++;
    onChange({ ...EMPTY_FILTERS, q: filters.q });
    setNearMe(null);
    setLocationStatus('idle');
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="Close filters" onPress={onClose} style={styles.scrim} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Filters</Text>
            <Pressable accessibilityLabel="Close filters" onPress={onClose} style={styles.closeSheet}>
              <Icon name="x" size={17} color={colors.muted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false} style={styles.sheetScroll}>
            <FilterGroup title="Near you">
              <FilterChip active={Boolean(nearMe)} label={locationStatus === 'locating' ? 'Finding your location…' : 'Near me · Within 25 km'} icon="map-pin" onPress={onToggleNearMe} />
              {locationStatus === 'denied' ? <Text style={styles.locationMessage}>Location is unavailable. You can still filter by city.</Text> : null}
            </FilterGroup>

            <FilterGroup title="Where">
              <FilterChip active={filters.mode === 'all'} label="All" icon="shopping-bag" onPress={() => onChange({ ...filters, mode: 'all' })} />
              <FilterChip active={filters.mode === 'physical'} label="In store" icon="shopping-bag" onPress={() => onChange({ ...filters, mode: 'physical' })} />
              <FilterChip active={filters.mode === 'online'} label="Online" icon="globe" onPress={() => onChange({ ...filters, mode: 'online' })} />
            </FilterGroup>

            <FilterGroup title="Offers">
              <FilterChip active={filters.hasOffer} label="Has an active offer" icon="tag" onPress={() => onChange({ ...filters, hasOffer: !filters.hasOffer })} />
            </FilterGroup>

            {cities.length > 1 ? (
              <FilterGroup title="City">
                <FilterChip active={!filters.city} label="All cities" icon="map-pin" onPress={() => onChange({ ...filters, city: '' })} />
                {cities.map((city) => <FilterChip key={city} active={filters.city === city} label={city} icon="map-pin" onPress={() => onChange({ ...filters, city: filters.city === city ? '' : city })} />)}
              </FilterGroup>
            ) : null}

            {categories.length > 0 ? (
              <FilterGroup title="Category">
                <FilterChip active={!filters.category} label="All categories" icon="shopping-bag" onPress={() => onChange({ ...filters, category: '' })} />
                {categories.map((category) => <FilterChip key={category.slug} active={filters.category === category.slug} label={category.name} onPress={() => onChange({ ...filters, category: filters.category === category.slug ? '' : category.slug })} />)}
              </FilterGroup>
            ) : null}
          </ScrollView>

          <View style={styles.sheetActions}>
            <Pressable onPress={onClearAll} style={styles.clearAll}><Text style={styles.clearAllText}>Clear all</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={locationStatus === 'locating'} onPress={() => onApply(filters, nearMe)} style={[styles.showResults, locationStatus === 'locating' && styles.controlPressed]}><Text style={styles.showResultsText}>Apply filters</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.filterGroup}><Text style={styles.filterGroupTitle}>{title}</Text><View style={styles.chipRow}>{children}</View></View>;
}

function FilterChip({ active, icon, label, onPress }: { active: boolean; icon?: 'shopping-bag' | 'globe' | 'tag' | 'map-pin'; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.filterChip, active && styles.filterChipActive, pressed && styles.controlPressed]}>
      {icon ? <Icon name={icon} size={12} color={active ? colors.white : colors.muted} /> : null}
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function EmptyState({ icon, title, children }: { icon: 'wifi-off' | 'shopping-bag'; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.emptyState}>
      <Icon name={icon} size={36} color={colors.line} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {children}
    </View>
  );
}

function EmptyAction({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.emptyAction}><Text style={styles.emptyActionText}>{label}</Text></Pressable>;
}

function ItemSeparator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.paper, flex: 1 },
  listContent: { alignSelf: 'center', maxWidth: 960, paddingBottom: 88, width: '100%' },
  directoryTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 28 },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, marginBottom: 14 },
  titleCopy: { flex: 1, gap: 4 },
  subtitle: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20 },
  appliedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  appliedChip: { alignItems: 'center', backgroundColor: colors.tint, borderRadius: 999, flexDirection: 'row', gap: 6, minHeight: 44, paddingHorizontal: 12 },
  appliedLabel: { color: colors.tealDark, fontFamily: fontFamily.sansSemiBold, fontSize: 13 },
  resultStrip: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, flexDirection: 'row', gap: 8, marginTop: 10, paddingLeft: 12, paddingRight: 6 },
  resultText: { color: colors.muted, flexShrink: 1, fontFamily: fontFamily.sansMedium, fontSize: 13 },
  nearbyButton: { alignItems: 'center', flexDirection: 'row', gap: 4, marginLeft: 'auto', minHeight: 44, paddingHorizontal: 8 },
  footer: { alignItems: 'center', paddingTop: 12 },
  emptyBody: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, marginTop: 6, textAlign: 'center' },
  categoryRow: { gap: 8, paddingTop: 12 },
  toolbarWrap: { paddingBottom: 12, paddingTop: 12 },
  columnRow: { gap: 12 },
  gridItem: { flex: 1, minWidth: 0 },
  gridItemWide: { maxWidth: '50%' },
  controlPressed: { opacity: 0.72 },
  locationMessage: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 16, width: '100%' },
  separator: { height: 4 },
  loadingState: { alignItems: 'center', minHeight: 260, paddingTop: 80 },
  emptyState: { alignItems: 'center', borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderStyle: 'dashed', borderWidth: 1, marginTop: 16, padding: 40 },
  emptyTitle: { color: colors.ink, fontFamily: fontFamily.sansMedium, fontSize: 16, marginTop: 12, textAlign: 'center' },
  emptyAction: { minHeight: 44, justifyContent: 'center', marginTop: 8, paddingHorizontal: 12 },
  emptyActionText: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: 'rgba(0,0,0,0.40)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%', paddingHorizontal: 20, paddingTop: 20 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  sheetScroll: { flexShrink: 1 },
  sheetContent: { paddingBottom: 4 },
  sheetTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 20 },
  closeSheet: { alignItems: 'center', borderRadius: 999, height: 48, justifyContent: 'center', width: 48 },
  filterGroup: { marginBottom: 20 },
  filterGroupTitle: { color: colors.muted, fontFamily: fontFamily.sansSemiBold, fontSize: 12, letterSpacing: 0.7, marginBottom: 8, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 6, minHeight: 48, paddingHorizontal: 14, paddingVertical: 8 },
  filterChipActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  filterChipText: { color: colors.muted, fontFamily: fontFamily.sansMedium, fontSize: 12 },
  filterChipTextActive: { color: colors.white },
  sheetActions: { flexDirection: 'row', gap: 8, paddingTop: 4 },
  clearAll: { alignItems: 'center', borderColor: colors.line, borderRadius: 999, borderWidth: 1, flex: 1, minHeight: 48, justifyContent: 'center' },
  clearAllText: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
  showResults: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 999, flex: 1, minHeight: 48, justifyContent: 'center' },
  showResultsText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
});
