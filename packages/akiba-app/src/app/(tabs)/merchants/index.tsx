// GET /api/v1/merchants — native port of hub-page's directory surface.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createApiClient } from '@/api';
import { DiscoveryToolbar } from '@/components/discovery-toolbar';
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
  const firstFetch = useRef(true);
  const lastExternalQuery = useRef(initialQuery);
  const lastFilterRequest = useRef(params.filterRequest);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, q: initialQuery });
  const [nearMe, setNearMe] = useState<Coordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'locating' | 'denied'>('idle');
  const [merchants, setMerchants] = useState<MerchantValueSummary[]>([]);
  const [allCategories, setAllCategories] = useState<{ slug: string; name: string }[]>([]);
  const [allCities, setAllCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(Boolean(params.filterRequest));

  const load = useCallback(async (nextFilters: Filters, coordinates: Coordinates | null) => {
    setLoading(true);
    setError(null);
    try {
      const data = await createApiClient().getMerchants({
        q: nextFilters.q.trim() || undefined,
        category: nextFilters.category || undefined,
        city: nextFilters.city || undefined,
        mode: nextFilters.mode,
        lat: coordinates?.lat,
        lng: coordinates?.lng,
        radius_km: coordinates ? 25 : undefined,
      });
      setMerchants(data.merchants);
      if (firstFetch.current) {
        const categories = new Map<string, string>();
        const cities = new Set<string>();
        data.merchants.forEach((merchant) => {
          if (merchant.primaryCategory) categories.set(merchant.primaryCategory.slug, merchant.primaryCategory.name);
          if (merchant.nearestLocation?.city) cities.add(merchant.nearestLocation.city);
        });
        setAllCategories([...categories].map(([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name)));
        setAllCities([...cities].sort());
        firstFetch.current = false;
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => load(filters, nearMe), firstFetch.current ? 0 : 250);
    return () => clearTimeout(handle);
  }, [filters, load, nearMe]);

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

  const toggleNearMe = useCallback(async () => {
    if (nearMe) {
      setNearMe(null);
      setLocationStatus('idle');
      return;
    }
    setLocationStatus('locating');
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setLocationStatus('denied');
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setNearMe({ lat: position.coords.latitude, lng: position.coords.longitude });
      setLocationStatus('idle');
    } catch {
      setLocationStatus('denied');
    }
  }, [nearMe]);

  return (
    <View style={styles.screen}>
      <FlatList
        key={`merchant-columns-${columns}`}
        columnWrapperStyle={columns > 1 ? styles.columnRow : undefined}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.listContent, { paddingHorizontal: horizontalGutter }]}
        data={visibleMerchants}
        keyExtractor={(merchant) => merchant.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <DirectoryHeader
            activeFilterCount={activeFilterCount}
            filters={filters}
            onChangeQuery={(q) => setFilters((current) => ({ ...current, q }))}
            onOpenFilters={() => setFiltersOpen(true)}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingState}><ActivityIndicator color={colors.teal} /></View>
          ) : error ? (
            <EmptyState icon="wifi-off" title="Merchants are temporarily unavailable" action="Retry" onAction={() => load(filters, nearMe)} />
          ) : (
            <EmptyState icon="shopping-bag" title="No merchants match" action="Clear filters" onAction={() => { setFilters(EMPTY_FILTERS); setNearMe(null); }} />
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.gridItem, columns > 1 && styles.gridItemWide]}><MerchantDirectoryCard merchant={item} onPress={() => router.push(`/merchants/${item.slug}`)} /></View>
        )}
        ItemSeparatorComponent={ItemSeparator}
        numColumns={columns}
      />

      <FiltersSheet
        categories={allCategories}
        cities={allCities}
        filters={filters}
        locationStatus={locationStatus}
        nearMe={nearMe}
        onChange={setFilters}
        onClearAll={() => { setFilters((current) => ({ ...EMPTY_FILTERS, q: current.q })); setNearMe(null); setLocationStatus('idle'); }}
        onClose={() => setFiltersOpen(false)}
        onToggleNearMe={toggleNearMe}
        open={filtersOpen}
      />
    </View>
  );
}

function DirectoryHeader({
  activeFilterCount,
  filters,
  onChangeQuery,
  onOpenFilters,
}: {
  activeFilterCount: number;
  filters: Filters;
  onChangeQuery: (query: string) => void;
  onOpenFilters: () => void;
}) {
  return (
    <View style={styles.toolbarWrap}>
      <DiscoveryToolbar activeFilterCount={activeFilterCount} onChangeText={onChangeQuery} onOpenFilters={onOpenFilters} value={filters.q} />
    </View>
  );
}

function FiltersSheet({
  categories,
  cities,
  filters,
  locationStatus,
  nearMe,
  onChange,
  onClearAll,
  onClose,
  onToggleNearMe,
  open,
}: {
  categories: { slug: string; name: string }[];
  cities: string[];
  filters: Filters;
  locationStatus: 'idle' | 'locating' | 'denied';
  nearMe: Coordinates | null;
  onChange: (filters: Filters) => void;
  onClearAll: () => void;
  onClose: () => void;
  onToggleNearMe: () => void;
  open: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}>
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
              <FilterChip active={Boolean(nearMe)} label={locationStatus === 'locating' ? 'Finding your location…' : 'Within 25 km'} icon="map-pin" onPress={onToggleNearMe} />
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
            <Pressable onPress={onClose} style={styles.showResults}><Text style={styles.showResultsText}>Show results</Text></Pressable>
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

function EmptyState({ icon, title, action, onAction }: { icon: 'wifi-off' | 'shopping-bag'; title: string; action: string; onAction: () => void }) {
  return (
    <View style={styles.emptyState}>
      <Icon name={icon} size={36} color={colors.line} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Pressable onPress={onAction} style={styles.emptyAction}><Text style={styles.emptyActionText}>{action}</Text></Pressable>
    </View>
  );
}

function ItemSeparator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.paper, flex: 1 },
  listContent: { alignSelf: 'center', maxWidth: 960, paddingBottom: 28, width: '100%' },
  toolbarWrap: { paddingBottom: 12, paddingTop: 12 },
  columnRow: { gap: 12 },
  gridItem: { flex: 1, minWidth: 0 },
  gridItemWide: { maxWidth: '50%' },
  controlPressed: { opacity: 0.72 },
  locationMessage: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 16, width: '100%' },
  separator: { height: 12 },
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
