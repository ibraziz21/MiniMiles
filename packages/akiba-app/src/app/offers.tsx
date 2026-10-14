import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Alert, Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import type { MobileHome } from '@/contracts';
import { ActivityIndicator, Icon, ScrollView, colors, fontFamily } from '@/design-system';
import { merchantOfferAvailability } from '@/lib/merchant-offer-availability';

type Offer = MobileHome['feed']['businessOffers'][number];
type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; offers: Offer[] };

export default function OffersScreen() {
  const { accessToken } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [index, setIndex] = useState(0);
  const [reminderPending, setReminderPending] = useState(false);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const home = await createApiClient({ accessToken }).getHome();
      setState({ status: 'ready', offers: home.feed.businessOffers });
      setIndex(0);
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Please try again.' });
    }
  }, [accessToken]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const offer = state.status === 'ready' ? state.offers[index] : undefined;
  const next = () => setIndex((current) => current + 1);

  function chooseReminder(current: Offer) {
    if (!current.remindersEnabled) return;
    if (!accessToken) {
      Alert.alert('Sign in required', 'Sign in to save an offer reminder.');
      return;
    }
    const save = async (leadMinutes: 30 | 60 | 1440) => {
      setReminderPending(true);
      try {
        await createApiClient({ accessToken }).setOfferReminder(current.id, leadMinutes);
        next();
      } catch (error) {
        Alert.alert('Reminder not saved', error instanceof Error ? error.message : 'Please try again.');
      } finally {
        setReminderPending(false);
      }
    };
    Alert.alert('Remind me', undefined, [
      { text: '30 minutes before', onPress: () => void save(30) },
      { text: '1 hour before', onPress: () => void save(60) },
      { text: '1 day before', onPress: () => void save(1440) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page} style={styles.screen}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton}>
            <Icon name="arrow-left" size={20} color={colors.ink} />
          </Pressable>
          <Text style={styles.headerTitle}>Business offers</Text>
          <View style={styles.iconSpacer} />
        </View>

        {state.status === 'loading' ? (
          <View style={styles.center}><ActivityIndicator color={colors.teal} /></View>
        ) : state.status === 'error' ? (
          <View style={styles.center}>
            <Text style={styles.message}>Offers are temporarily unavailable.</Text>
            <Pressable onPress={load} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable>
          </View>
        ) : !offer ? (
          <View style={styles.center}>
            <Icon name="check-circle" size={34} color={colors.teal} />
            <Text style={styles.doneTitle}>{state.offers.length === 0 ? 'No offers are live' : "You're caught up"}</Text>
            {state.offers.length > 0 ? (
              <Pressable onPress={() => setIndex(0)} style={styles.retry}><Text style={styles.retryText}>Start again</Text></Pressable>
            ) : null}
          </View>
        ) : (
          <OfferDeckCard
            offer={offer}
            position={index + 1}
            total={state.offers.length}
            reminderPending={reminderPending}
            onDismiss={next}
            onInterested={() => router.push(`/merchants/${offer.partner.slug}`)}
            onReminder={() => chooseReminder(offer)}
          />
        )}
      </View>
    </ScrollView>
  );
}

function OfferDeckCard({ offer, onDismiss, onInterested, onReminder, position, reminderPending, total }: {
  offer: Offer;
  onDismiss: () => void;
  onInterested: () => void;
  onReminder: () => void;
  position: number;
  reminderPending: boolean;
  total: number;
}) {
  const availability = merchantOfferAvailability(offer);
  const positionXY = useRef(new Animated.ValueXY()).current;
  const finishSwipe = useCallback((direction: -1 | 1) => {
    Animated.timing(positionXY, {
      duration: 180,
      toValue: { x: direction * 520, y: 0 },
      useNativeDriver: true,
    }).start(() => {
      positionXY.setValue({ x: 0, y: 0 });
      if (direction < 0) onDismiss();
      else onInterested();
    });
  }, [onDismiss, onInterested, positionXY]);
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderMove: Animated.event([null, { dx: positionXY.x, dy: positionXY.y }], { useNativeDriver: false }),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dx <= -90) finishSwipe(-1);
      else if (gesture.dx >= 90) finishSwipe(1);
      else Animated.spring(positionXY, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => Animated.spring(positionXY, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start(),
  }), [finishSwipe, positionXY]);
  const rotate = positionXY.x.interpolate({ inputRange: [-240, 0, 240], outputRange: ['-7deg', '0deg', '7deg'], extrapolate: 'clamp' });

  return (
    <View>
      <Text style={styles.progress}>{position} of {total}</Text>
      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.card, { transform: [{ translateX: positionXY.x }, { translateY: positionXY.y }, { rotate }] }]}>
        <View style={styles.imageWrap}>
          {offer.imageUrl ? (
            <Image accessibilityLabel="" source={{ uri: offer.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
          ) : (
            <View style={styles.fallback}><Icon name="shopping-bag" size={40} color={colors.teal} /></View>
          )}
          <View style={styles.status}><Text style={styles.statusText}>{availability.label}</Text></View>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.merchant}>{offer.partner.name}</Text>
          <Text style={styles.title}>{offer.title}</Text>
          <Text numberOfLines={3} style={styles.description}>{offer.description}</Text>
          <Text numberOfLines={2} style={styles.schedule}>{availability.scheduleLabel}</Text>
          <Text style={styles.miles}>No AkibaMiles required</Text>
        </View>
      </Animated.View>

      <View style={styles.actions}>
        <OfferAction icon="x" label="Skip" onPress={() => finishSwipe(-1)} />
        {offer.remindersEnabled ? (
          <OfferAction busy={reminderPending} icon="bell" label="Remind" onPress={onReminder} />
        ) : null}
        <OfferAction icon="arrow-right" label="View" onPress={() => finishSwipe(1)} primary />
      </View>
    </View>
  );
}

function OfferAction({ busy = false, icon, label, onPress, primary = false }: {
  busy?: boolean;
  icon: 'x' | 'bell' | 'arrow-right';
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable disabled={busy} onPress={onPress} style={({ pressed }) => [styles.action, primary && styles.actionPrimary, pressed && styles.pressed]}>
      {busy ? <ActivityIndicator color={colors.teal} size="small" /> : <Icon name={icon} size={18} color={primary ? colors.white : colors.ink} />}
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.paper },
  page: { paddingBottom: 32 },
  shell: { alignSelf: 'center', maxWidth: 560, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 60, paddingHorizontal: 12 },
  headerTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 20 },
  iconButton: { alignItems: 'center', borderRadius: 999, height: 44, justifyContent: 'center', width: 44 },
  iconSpacer: { width: 44 },
  center: { alignItems: 'center', justifyContent: 'center', minHeight: 420, padding: 32 },
  message: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, textAlign: 'center' },
  doneTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 22, marginTop: 12 },
  retry: { backgroundColor: colors.ink, borderRadius: 999, marginTop: 18, paddingHorizontal: 20, paddingVertical: 12 },
  retryText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 13 },
  progress: { color: colors.muted, fontFamily: fontFamily.sansMedium, fontSize: 12, marginBottom: 10, marginHorizontal: 16 },
  card: { backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 26, borderWidth: 1, marginHorizontal: 16, overflow: 'hidden' },
  imageWrap: { backgroundColor: colors.tint, height: 300, position: 'relative' },
  fallback: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  status: { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 999, left: 14, paddingHorizontal: 11, paddingVertical: 7, position: 'absolute', top: 14 },
  statusText: { color: colors.ink, fontFamily: fontFamily.sansBold, fontSize: 11 },
  cardBody: { padding: 18 },
  merchant: { color: colors.muted, fontFamily: fontFamily.sansMedium, fontSize: 13 },
  title: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 26, lineHeight: 31, marginTop: 4 },
  description: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20, marginTop: 8 },
  schedule: { color: colors.ink, fontFamily: fontFamily.sansMedium, fontSize: 12, lineHeight: 18, marginTop: 14 },
  miles: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 11, marginTop: 10 },
  actions: { flexDirection: 'row', gap: 10, justifyContent: 'center', paddingHorizontal: 16, paddingTop: 18 },
  action: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 48, paddingHorizontal: 17 },
  actionPrimary: { backgroundColor: colors.ink, borderColor: colors.ink },
  actionText: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 13 },
  actionTextPrimary: { color: colors.white },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
});
