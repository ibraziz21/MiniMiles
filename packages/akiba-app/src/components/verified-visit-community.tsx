import { useCallback, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import {
  Alert,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CustomerPhoto, VerifiedVisit } from '@/contracts';
import { ActivityIndicator, Icon, colors, fontFamily, shadows } from '@/design-system';

const VISIT_SWIPE_THRESHOLD = 72;
const PHOTO_SWIPE_THRESHOLD = 48;

export function VerifiedVisitCommunity({
  favoriteProduct,
  helpfulVisitIds,
  merchantName,
  merchantSlug,
  onToggleHelpful,
  onToggleSave,
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
  refreshVisitPhoto: (photoId: string, updateProfile?: boolean) => Promise<CustomerPhoto | null>;
  savePending: boolean;
  saved: boolean;
  visits: VerifiedVisit[];
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [visitIndex, setVisitIndex] = useState(0);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [helpfulPending, setHelpfulPending] = useState(false);
  const [translation] = useState(() => new Animated.ValueXY());

  const current = visits[visitIndex] ?? null;
  const next = visits[visitIndex + 1] ?? null;
  const photos = current?.photos ?? [];
  const currentPhoto = photos[photoIndex] ?? null;
  const summaryPhoto = visits.flatMap((visit) => visit.photos)[0] ?? null;
  const deckWidth = Math.min(Math.max(width - 32, 288), 560);
  const cardWidth = deckWidth - 24;
  const exactCount = visits.length >= 5;
  const countCopy = exactCount ? `${visits.length} verified visits` : 'New from verified visits';
  const progressCopy = exactCount ? `${visitIndex + 1} of ${visits.length}` : 'Anonymous verified visit';
  const helpful = current ? helpfulVisitIds.has(current.id) : false;

  const moveVisit = useCallback((direction: -1 | 1) => {
    const target = visitIndex + direction;
    if (target < 0 || target >= visits.length) {
      Animated.spring(translation, { friction: 7, tension: 80, toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(translation, {
      duration: 170,
      toValue: { x: direction > 0 ? -(cardWidth + 60) : cardWidth + 60, y: 0 },
      useNativeDriver: true,
    }).start(() => {
      setVisitIndex(target);
      setPhotoIndex(0);
      translation.setValue({ x: 0, y: 0 });
    });
  }, [cardWidth, translation, visitIndex, visits.length]);

  const visitPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderMove: Animated.event([null, { dx: translation.x }], { useNativeDriver: false }),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dx <= -VISIT_SWIPE_THRESHOLD || gesture.vx < -0.65) moveVisit(1);
      else if (gesture.dx >= VISIT_SWIPE_THRESHOLD || gesture.vx > 0.65) moveVisit(-1);
      else Animated.spring(translation, { friction: 7, tension: 80, toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => Animated.spring(translation, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start(),
  }), [moveVisit, translation]);

  const photoPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => photos.length > 1 && Math.abs(gesture.dx) > 7 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderRelease: (_event, gesture) => {
      if (photos.length < 2) return;
      if (gesture.dx <= -PHOTO_SWIPE_THRESHOLD || gesture.vx < -0.55) {
        setPhotoIndex((value) => (value + 1) % photos.length);
      } else if (gesture.dx >= PHOTO_SWIPE_THRESHOLD || gesture.vx > 0.55) {
        setPhotoIndex((value) => (value - 1 + photos.length) % photos.length);
      }
    },
  }), [photos.length]);

  async function toggleHelpful() {
    if (!current || helpfulPending) return;
    setHelpfulPending(true);
    try {
      await onToggleHelpful(current.id);
    } finally {
      setHelpfulPending(false);
    }
  }

  async function shareCommunity() {
    const base = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? 'https://hub.akibamiles.com';
    try {
      await Share.share({
        title: `${merchantName} on Akiba`,
        message: `See verified visits to ${merchantName}: ${base}/merchants/${merchantSlug}`,
        url: `${base}/merchants/${merchantSlug}`,
      });
    } catch {
      Alert.alert('Could not open sharing', 'Please try again.');
    }
  }

  if (visits.length === 0) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIcon}><Icon name="check-circle" size={28} color={colors.teal} /></View>
        <Text style={styles.emptyTitle}>No verified visits yet</Text>
        <Text style={styles.emptyBody}>Recommendations and approved photos from verified Akiba visits will appear here.</Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        accessibilityHint="Opens anonymous customer visit cards"
        accessibilityLabel={`Community at ${merchantName}. ${countCopy}`}
        onPress={() => { setVisitIndex(0); setPhotoIndex(0); setOpen(true); }}
        style={({ pressed }) => [styles.communityCard, pressed && styles.pressed]}
      >
        <View style={styles.communityImageWrap}>
          {summaryPhoto ? (
            <Image accessibilityLabel={summaryPhoto.altText} contentFit="cover" source={{ uri: summaryPhoto.thumbnailUrl }} style={StyleSheet.absoluteFill} transition={160} />
          ) : (
            <View style={styles.imageFallback}><Icon name="users" size={42} color={colors.teal} /></View>
          )}
          <View style={styles.communityBadge}><Icon name="check-circle" size={15} color={colors.teal} /><Text style={styles.communityBadgeText}>Community verified</Text></View>
        </View>
        <View style={styles.communityBody}>
          <Text style={styles.communityCount}>{countCopy}</Text>
          <Text style={styles.communityTitle}>Community at {merchantName}</Text>
          <Text style={styles.communityDescription}>Swipe through anonymous recommendations and photos from eligible Akiba purchases.</Text>
          {favoriteProduct ? <View style={styles.favoriteBox}><Text style={styles.eyebrow}>Community favorite</Text><Text style={styles.favoriteProduct}>{favoriteProduct}</Text></View> : null}
          <View style={styles.exploreRow}><Text style={styles.exploreText}>Explore the community</Text><Icon name="chevron-right" size={18} color={colors.white} /></View>
        </View>
      </Pressable>

      <Modal animationType="slide" onRequestClose={() => setOpen(false)} transparent visible={open}>
        <View style={styles.modalScrim}>
          <View style={[styles.modalSheet, { paddingTop: Math.max(insets.top, 14), paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.modalHeader}>
              <View style={styles.flex}><Text style={styles.modalEyebrow}>Community at {merchantName}</Text><Text style={styles.modalProgress}>{progressCopy}</Text></View>
              <Pressable accessibilityLabel="Close community visits" onPress={() => setOpen(false)} style={styles.closeButton}><Icon name="x" size={21} color={colors.ink} /></Pressable>
            </View>

            <ScrollView
              bounces={false}
              contentContainerStyle={styles.modalContent}
              showsVerticalScrollIndicator={false}
            >
              {current ? (
                <View style={[styles.deckArea, { width: deckWidth }]}>
                  {next ? <View pointerEvents="none" style={[styles.nextCard, { width: cardWidth }]} /> : null}
                  <Animated.View style={[styles.visitCard, { width: cardWidth, transform: [{ translateX: translation.x }] }]}>
                    <View {...photoPanResponder.panHandlers} style={styles.visitImageWrap}>
                      {currentPhoto ? (
                        <RefreshableVisitImage photo={currentPhoto} refreshVisitPhoto={refreshVisitPhoto} />
                      ) : (
                        <View style={styles.imageFallback}><Icon name="check-circle" size={56} color={colors.teal} /></View>
                      )}
                      <View style={styles.verifiedBadge}><Icon name="check-circle" size={15} color={colors.teal} /><Text style={styles.verifiedBadgeText}>Verified visit</Text></View>
                      {photos.length > 1 ? (
                        <>
                          <Pressable accessibilityLabel="Previous visit photo" onPress={() => setPhotoIndex((value) => (value - 1 + photos.length) % photos.length)} style={[styles.photoArrow, styles.photoArrowLeft]}><Icon name="chevron-left" size={20} color={colors.white} /></Pressable>
                          <Pressable accessibilityLabel="Next visit photo" onPress={() => setPhotoIndex((value) => (value + 1) % photos.length)} style={[styles.photoArrow, styles.photoArrowRight]}><Icon name="chevron-right" size={20} color={colors.white} /></Pressable>
                          <View style={styles.photoCount}><Icon name="image" size={13} color={colors.white} /><Text style={styles.photoCountText}>{photoIndex + 1} / {photos.length}</Text></View>
                        </>
                      ) : null}
                    </View>

                    <View {...visitPanResponder.panHandlers} style={styles.visitBody}>
                      {current.favoriteOrder ? <><Text style={styles.eyebrow}>Favorite order</Text><Text style={styles.visitFavorite}>{current.favoriteOrder}</Text></> : null}
                      {current.experienceLabels.length > 0 ? (
                        <View style={current.favoriteOrder ? styles.labelsSection : undefined}>
                          <Text style={styles.eyebrow}>What stood out on this visit</Text>
                          <View style={styles.labelRow}>{current.experienceLabels.map((label) => <View key={label} style={styles.label}><Text style={styles.labelText}>{label}</Text></View>)}</View>
                        </View>
                      ) : null}
                      <Text style={styles.privacyNote}>Shared anonymously after an eligible Akiba purchase. Each slide is from a different customer.</Text>
                    </View>
                  </Animated.View>
                </View>
              ) : null}

              <View style={styles.visitNavigation}>
                <Pressable accessibilityLabel="Previous verified visit" disabled={visitIndex === 0} onPress={() => moveVisit(-1)} style={[styles.navButton, visitIndex === 0 && styles.disabled]}><Icon name="chevron-left" size={20} color={colors.ink} /></Pressable>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${((visitIndex + 1) / visits.length) * 100}%` }]} /></View>
                <Pressable accessibilityLabel="Next verified visit" disabled={visitIndex === visits.length - 1} onPress={() => moveVisit(1)} style={[styles.navButton, visitIndex === visits.length - 1 && styles.disabled]}><Icon name="chevron-right" size={20} color={colors.ink} /></Pressable>
              </View>

              {helpful ? <View style={styles.confirmation}><Icon name="check-circle" size={17} color={colors.teal} /><Text style={styles.confirmationText}>Thanks — this helps surface useful visits.</Text></View> : null}
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" accessibilityState={{ selected: helpful, busy: helpfulPending }} disabled={helpfulPending} onPress={toggleHelpful} style={({ pressed }) => [styles.action, helpful && styles.actionSelected, pressed && styles.pressed]}>
                  {helpfulPending ? <ActivityIndicator color={colors.teal} size="small" /> : <Icon name="thumbs-up" size={20} color={helpful ? colors.teal : colors.ink} />}
                  <Text style={[styles.actionText, helpful && styles.actionTextSelected]}>Helpful</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityState={{ selected: saved, busy: savePending }} disabled={savePending} onPress={onToggleSave} style={({ pressed }) => [styles.action, saved && styles.actionSelected, pressed && styles.pressed]}>
                  {savePending ? <ActivityIndicator color={colors.teal} size="small" /> : <Icon name="bookmark" size={20} color={saved ? colors.teal : colors.ink} />}
                  <Text style={[styles.actionText, saved && styles.actionTextSelected]}>Save</Text>
                </Pressable>
                <Pressable accessibilityLabel={`Share ${merchantName}`} accessibilityRole="button" onPress={() => void shareCommunity()} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Icon name="share-2" size={20} color={colors.ink} /><Text style={styles.actionText}>Share</Text></Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function RefreshableVisitImage({ photo, refreshVisitPhoto }: { photo: CustomerPhoto; refreshVisitPhoto: (photoId: string, updateProfile?: boolean) => Promise<CustomerPhoto | null> }) {
  const [uri, setUri] = useState(photo.displayUrl.trim() || photo.thumbnailUrl.trim());
  const [attempted, setAttempted] = useState(false);
  return (
    <Image
      accessibilityLabel={photo.altText}
      cachePolicy="memory-disk"
      contentFit="cover"
      onError={async () => {
        if (attempted) return;
        setAttempted(true);
        const refreshed = await refreshVisitPhoto(photo.id, false);
        setUri(refreshed?.displayUrl.trim() || refreshed?.thumbnailUrl.trim() || photo.thumbnailUrl.trim());
      }}
      source={{ uri }}
      style={StyleSheet.absoluteFill}
      transition={160}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  communityCard: { ...shadows.soft, backgroundColor: colors.white, borderColor: colors.line, borderRadius: 24, borderWidth: 1, margin: 16, overflow: 'hidden' },
  communityImageWrap: { backgroundColor: colors.tint, height: 224, position: 'relative' },
  imageFallback: { alignItems: 'center', backgroundColor: colors.tint, flex: 1, justifyContent: 'center' },
  communityBadge: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 6, left: 12, paddingHorizontal: 10, paddingVertical: 6, position: 'absolute', top: 12 },
  communityBadgeText: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 11 },
  communityBody: { padding: 18 },
  communityCount: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  communityTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 24, lineHeight: 29, marginTop: 6 },
  communityDescription: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20, marginTop: 7 },
  favoriteBox: { backgroundColor: colors.card, borderRadius: 16, marginTop: 15, padding: 13 },
  eyebrow: { color: colors.muted, fontFamily: fontFamily.sansSemiBold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
  favoriteProduct: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 18, marginTop: 3 },
  exploreRow: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.ink, borderRadius: 999, flexDirection: 'row', gap: 7, marginTop: 16, minHeight: 44, paddingHorizontal: 17 },
  exploreText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 13 },
  modalScrim: { backgroundColor: colors.scrim, flex: 1, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '96%', width: '100%' },
  modalContent: { paddingBottom: 2 },
  modalHeader: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 62, paddingHorizontal: 16 },
  modalEyebrow: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
  modalProgress: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 18, marginTop: 2 },
  closeButton: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 },
  deckArea: { alignSelf: 'center', marginTop: 14, minHeight: 462, position: 'relative' },
  nextCard: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 24, borderWidth: 1, bottom: 4, left: 22, opacity: 0.7, position: 'absolute', top: 10 },
  visitCard: { ...shadows.soft, backgroundColor: colors.white, borderColor: colors.line, borderRadius: 24, borderWidth: 1, left: 0, overflow: 'hidden', position: 'absolute', top: 0 },
  visitImageWrap: { backgroundColor: colors.tint, height: 248, position: 'relative' },
  verifiedBadge: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 999, flexDirection: 'row', gap: 6, left: 12, paddingHorizontal: 10, paddingVertical: 6, position: 'absolute', top: 12 },
  verifiedBadgeText: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 11 },
  photoArrow: { alignItems: 'center', backgroundColor: colors.imageControl, borderRadius: 999, height: 44, justifyContent: 'center', position: 'absolute', top: 102, width: 44 },
  photoArrowLeft: { left: 10 },
  photoArrowRight: { right: 10 },
  photoCount: { alignItems: 'center', alignSelf: 'center', backgroundColor: colors.imageControl, borderRadius: 999, bottom: 10, flexDirection: 'row', gap: 5, paddingHorizontal: 9, paddingVertical: 5, position: 'absolute' },
  photoCountText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 11 },
  visitBody: { minHeight: 200, padding: 18 },
  visitFavorite: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 23, lineHeight: 28, marginTop: 3 },
  labelsSection: { marginTop: 16 },
  labelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 },
  label: { backgroundColor: colors.paper, borderColor: colors.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 6 },
  labelText: { color: colors.ink, fontFamily: fontFamily.sansMedium, fontSize: 12 },
  privacyNote: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 11, lineHeight: 16, marginTop: 16 },
  visitNavigation: { alignItems: 'center', flexDirection: 'row', gap: 12, marginTop: 10, paddingHorizontal: 16 },
  navButton: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 999, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  disabled: { opacity: 0.35 },
  progressTrack: { backgroundColor: colors.line, borderRadius: 999, flex: 1, height: 4, overflow: 'hidden' },
  progressFill: { backgroundColor: colors.teal, borderRadius: 999, height: 4 },
  confirmation: { alignItems: 'center', alignSelf: 'center', backgroundColor: colors.tint, borderRadius: 14, flexDirection: 'row', gap: 7, marginHorizontal: 16, marginTop: 10, paddingHorizontal: 13, paddingVertical: 10 },
  confirmationText: { color: colors.teal, fontFamily: fontFamily.sansMedium, fontSize: 12 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10, paddingHorizontal: 16 },
  action: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 16, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 50 },
  actionSelected: { backgroundColor: colors.tint, borderColor: colors.teal },
  actionText: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 12 },
  actionTextSelected: { color: colors.teal },
  empty: { alignItems: 'center', paddingHorizontal: 28, paddingVertical: 42 },
  emptyIcon: { alignItems: 'center', backgroundColor: colors.tint, borderRadius: 999, height: 54, justifyContent: 'center', width: 54 },
  emptyTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 20, marginTop: 14 },
  emptyBody: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 13, lineHeight: 19, marginTop: 5, textAlign: 'center' },
});
