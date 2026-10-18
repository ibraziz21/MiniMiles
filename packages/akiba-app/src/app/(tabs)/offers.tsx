import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import {
  Alert,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import { ProfileButton } from '@/components/profile-button';
import type { MerchantOfferFeedItem } from '@/contracts';
import { ActivityIndicator, Icon, colors, fontFamily, shadows } from '@/design-system';
import { loadOfferDecisionState, saveOfferDecisionState } from '@/lib/offer-decision-storage';
import {
  clearOfferDecisions,
  decidedOfferIds,
  recordOfferDecision,
  removeOfferDecision,
  type OfferDecision,
  type OfferDecisionState,
} from '@/lib/offer-decisions';
import { merchantOfferAvailability } from '@/lib/merchant-offer-availability';

type ReadyState = {
  status: 'ready';
  allOffers: MerchantOfferFeedItem[];
  deck: MerchantOfferFeedItem[];
  decisions: OfferDecisionState;
};

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | ReadyState;

type LastChoice = { offer: MerchantOfferFeedItem; decision: OfferDecision };

export default function OffersScreen() {
  const { accessToken, session } = useAuth();
  const { height, width } = useWindowDimensions();
  const scope = session?.user.id ?? 'guest';
  const [state, setState] = useState<ScreenState>({ status: 'loading' });
  const [lastChoice, setLastChoice] = useState<LastChoice | null>(null);
  const [reminderPending, setReminderPending] = useState(false);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    setLastChoice(null);
    try {
      const [{ offers }, decisions] = await Promise.all([
        createApiClient({ accessToken }).getMerchantOffers(),
        loadOfferDecisionState(scope),
      ]);
      const decided = decidedOfferIds(decisions);
      setState({
        status: 'ready',
        allOffers: offers,
        deck: offers.filter((offer) => !decided.has(offer.id)),
        decisions,
      });
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Please try again.' });
    }
  }, [accessToken, scope]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const commitChoice = useCallback((decision: OfferDecision) => {
    if (state.status !== 'ready' || state.deck.length === 0) return;
    const [offer, ...deck] = state.deck;
    const decisions = recordOfferDecision(state.decisions, offer.id, decision);
    setState({ ...state, deck, decisions });
    setLastChoice({ offer, decision });
    void saveOfferDecisionState(scope, decisions);
  }, [scope, state]);

  const undoLastChoice = useCallback(() => {
    if (!lastChoice) return;
    if (state.status !== 'ready') return;
    const decisions = removeOfferDecision(state.decisions, lastChoice.offer.id);
    setState({ ...state, deck: [lastChoice.offer, ...state.deck], decisions });
    setLastChoice(null);
    void saveOfferDecisionState(scope, decisions);
  }, [lastChoice, scope, state]);

  const reviewAgain = useCallback(() => {
    if (state.status !== 'ready') return;
    const decisions = clearOfferDecisions(state.decisions, state.allOffers.map((offer) => offer.id));
    setState({ ...state, deck: state.allOffers, decisions });
    setLastChoice(null);
    void saveOfferDecisionState(scope, decisions);
  }, [scope, state]);

  const chooseReminder = useCallback((offer: MerchantOfferFeedItem) => {
    if (!offer.remindersEnabled) return;
    if (!accessToken) {
      Alert.alert('Sign in required', 'Sign in to save an offer reminder.');
      return;
    }

    const save = async (leadMinutes: 30 | 60 | 1440) => {
      setReminderPending(true);
      try {
        await createApiClient({ accessToken }).setOfferReminder(offer.id, leadMinutes);
        commitChoice('reminder');
      } catch (error) {
        Alert.alert('Reminder not saved', error instanceof Error ? error.message : 'Please try again.');
      } finally {
        setReminderPending(false);
      }
    };

    Alert.alert('Remind me', 'Choose a time.', [
      { text: '30 minutes before', onPress: () => void save(30) },
      { text: '1 hour before', onPress: () => void save(60) },
      { text: '1 day before', onPress: () => void save(1440) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [accessToken, commitChoice]);

  const cardWidth = Math.min(width - 32, 520);
  const cardHeight = Math.min(Math.max(height - 320, 400), 550);

  return (
    <View style={styles.screen}>
      <View style={styles.shell}>
        <Header state={state} />

        {state.status === 'loading' ? (
          <CenteredState><ActivityIndicator color={colors.teal} /></CenteredState>
        ) : state.status === 'error' ? (
          <CenteredState>
            <Text style={styles.stateTitle}>Offers are unavailable</Text>
            <Pressable onPress={load} style={({ pressed }) => [styles.stateButton, pressed && styles.pressed]}>
              <Text style={styles.stateButtonText}>Retry</Text>
            </Pressable>
          </CenteredState>
        ) : state.allOffers.length === 0 ? (
          <CenteredState>
            <View style={styles.stateIcon}><Icon name="tag" size={24} color={colors.teal} /></View>
            <Text style={styles.stateTitle}>No offers are live</Text>
          </CenteredState>
        ) : state.deck.length === 0 ? (
          <CenteredState>
            <View style={styles.stateIcon}><Icon name="check" size={25} color={colors.teal} /></View>
            <Text style={styles.stateTitle}>You’re caught up</Text>
            <Pressable onPress={reviewAgain} style={({ pressed }) => [styles.stateButton, pressed && styles.pressed]}>
              <Text style={styles.stateButtonText}>Review again</Text>
            </Pressable>
          </CenteredState>
        ) : (
          <View style={styles.deckScreen}>
            <OfferDeck
              cardHeight={cardHeight}
              cardWidth={cardWidth}
              current={state.deck[0]}
              next={state.deck[1]}
              reminderPending={reminderPending}
              onDismiss={() => commitChoice('dismissed')}
              onInterested={() => commitChoice('interested')}
              onReminder={() => chooseReminder(state.deck[0])}
              onView={() => router.push(`/merchants/${state.deck[0].partner.slug}`)}
            />

            <View style={styles.undoSlot}>
              {lastChoice ? (
                <Pressable accessibilityLabel="Undo last choice" onPress={undoLastChoice} style={({ pressed }) => [styles.undo, pressed && styles.pressed]}>
                  <Icon name="rotate-ccw" size={16} color={colors.teal} />
                  <Text style={styles.undoText}>Undo</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function Header({ state }: { state: ScreenState }) {
  const progress = state.status === 'ready' && state.allOffers.length > 0
    ? `${state.allOffers.length - state.deck.length + (state.deck.length > 0 ? 1 : 0)} / ${state.allOffers.length}`
    : null;

  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Business offers</Text>
      <Text style={styles.progress}>{progress}</Text>
      <ProfileButton />
    </View>
  );
}

function CenteredState({ children }: { children: ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

function OfferDeck({ cardHeight, cardWidth, current, next, onDismiss, onInterested, onReminder, onView, reminderPending }: {
  cardHeight: number;
  cardWidth: number;
  current: MerchantOfferFeedItem;
  next?: MerchantOfferFeedItem;
  onDismiss: () => void;
  onInterested: () => void;
  onReminder: () => void;
  onView: () => void;
  reminderPending: boolean;
}) {
  const [translation] = useState(() => new Animated.ValueXY());
  const finishSwipe = useCallback((direction: -1 | 1) => {
    Animated.timing(translation, {
      duration: 180,
      toValue: { x: direction * (cardWidth + 100), y: 8 },
      useNativeDriver: true,
    }).start(() => {
      translation.setValue({ x: 0, y: 0 });
      if (direction < 0) onDismiss();
      else onInterested();
    });
  }, [cardWidth, onDismiss, onInterested, translation]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 7 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderMove: Animated.event([null, { dx: translation.x, dy: translation.y }], { useNativeDriver: false }),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dx <= -85 || gesture.vx < -0.7) finishSwipe(-1);
      else if (gesture.dx >= 85 || gesture.vx > 0.7) finishSwipe(1);
      else Animated.spring(translation, { friction: 7, tension: 80, toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => Animated.spring(translation, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start(),
  }), [finishSwipe, translation]);

  const rotation = translation.x.interpolate({
    inputRange: [-cardWidth, 0, cardWidth],
    outputRange: ['-8deg', '0deg', '8deg'],
    extrapolate: 'clamp',
  });
  const interestedOpacity = translation.x.interpolate({ inputRange: [30, 105], outputRange: [0, 1], extrapolate: 'clamp' });
  const dismissedOpacity = translation.x.interpolate({ inputRange: [-105, -30], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <View>
      <View style={[styles.deckArea, { height: cardHeight + 12, width: cardWidth }]}>
        {next ? (
          <View pointerEvents="none" style={[styles.nextCard, { height: cardHeight, width: cardWidth }]}>
            <OfferCardContent height={cardHeight} offer={next} />
          </View>
        ) : null}

        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.card,
            { height: cardHeight, width: cardWidth, transform: [{ translateX: translation.x }, { translateY: translation.y }, { rotate: rotation }] },
          ]}>
          <Pressable accessibilityLabel={`View ${current.title} from ${current.partner.name}`} onPress={onView} style={styles.cardPressable}>
            <OfferCardContent height={cardHeight} offer={current} />
          </Pressable>
          <Animated.View pointerEvents="none" style={[styles.swipeStamp, styles.interestedStamp, { opacity: interestedOpacity }]}>
            <Text style={styles.interestedStampText}>INTERESTED</Text>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.swipeStamp, styles.dismissedStamp, { opacity: dismissedOpacity }]}>
            <Text style={styles.dismissedStampText}>NOT FOR ME</Text>
          </Animated.View>
        </Animated.View>
      </View>

      <View style={styles.actions}>
        <CircleAction accessibilityLabel="Not interested" icon="x" onPress={() => finishSwipe(-1)} />
        {current.remindersEnabled ? (
          <CircleAction accessibilityLabel="Remind me" busy={reminderPending} icon="bell" onPress={onReminder} />
        ) : null}
        <CircleAction accessibilityLabel="Interested" icon="heart" onPress={() => finishSwipe(1)} primary />
      </View>
    </View>
  );
}

function OfferCardContent({ height, offer }: { height: number; offer: MerchantOfferFeedItem }) {
  const availability = merchantOfferAvailability(offer);
  const imageHeight = Math.round(height * 0.54);

  return (
    <View style={styles.cardContent}>
      <View style={[styles.imageWrap, { height: imageHeight }]}>
        {offer.imageUrl ? (
          <Image accessibilityLabel="" source={{ uri: offer.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
        ) : (
          <View style={styles.fallback}>
            {offer.partner.logoUrl ? (
              <Image accessibilityLabel="" source={{ uri: offer.partner.logoUrl }} style={styles.fallbackLogo} contentFit="contain" />
            ) : (
              <Icon name="shopping-bag" size={36} color={colors.teal} />
            )}
          </View>
        )}
        <View style={styles.status}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>{availability.label}</Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <Text numberOfLines={1} style={styles.merchant}>{offer.partner.name}</Text>
        <Text numberOfLines={2} style={styles.title}>{offer.title}</Text>
        <Text numberOfLines={2} style={styles.description}>{offer.description}</Text>
        <View style={styles.meta}>
          <View style={styles.metaRow}>
            <Icon name="calendar" size={15} color={colors.muted} />
            <Text numberOfLines={2} style={styles.schedule}>{availability.scheduleLabel}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.metaRow}>
            <Icon name="tag" size={15} color={colors.muted} />
            <Text style={styles.miles}>No AkibaMiles required</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function CircleAction({ accessibilityLabel, busy = false, icon, onPress, primary = false }: {
  accessibilityLabel: string;
  busy?: boolean;
  icon: 'x' | 'bell' | 'heart';
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.action, primary && styles.actionPrimary, pressed && styles.actionPressed]}>
      {busy ? (
        <ActivityIndicator color={colors.teal} size="small" />
      ) : (
        <Icon name={icon} size={24} color={primary ? colors.white : colors.ink} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.paper, flex: 1 },
  shell: { alignSelf: 'center', flex: 1, maxWidth: 560, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 64, paddingHorizontal: 16 },
  headerTitle: { color: colors.ink, flex: 1, fontFamily: fontFamily.sterlingSemiBold, fontSize: 24, lineHeight: 30 },
  progress: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 14, textAlign: 'right', width: 44 },
  deckScreen: { flex: 1, justifyContent: 'center', paddingBottom: 4 },
  deckArea: { alignSelf: 'center', position: 'relative' },
  nextCard: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 24, borderWidth: 1, left: 0, opacity: 0.72, overflow: 'hidden', position: 'absolute', top: 10, transform: [{ scale: 0.96 }] },
  card: { ...shadows.soft, backgroundColor: colors.white, borderColor: colors.line, borderRadius: 24, borderWidth: 1, left: 0, overflow: 'hidden', position: 'absolute', top: 0 },
  cardPressable: { flex: 1 },
  cardContent: { flex: 1 },
  imageWrap: { backgroundColor: colors.tint, overflow: 'hidden', position: 'relative' },
  fallback: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  fallbackLogo: { backgroundColor: colors.white, borderRadius: 18, height: 72, padding: 8, width: 72 },
  status: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 6, left: 12, paddingHorizontal: 10, paddingVertical: 6, position: 'absolute', top: 12 },
  statusDot: { backgroundColor: colors.teal, borderRadius: 999, height: 7, width: 7 },
  statusText: { color: colors.tealDark, fontFamily: fontFamily.sansSemiBold, fontSize: 11 },
  cardBody: { flex: 1, padding: 17 },
  merchant: { color: colors.muted, fontFamily: fontFamily.sansSemiBold, fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase' },
  title: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 25, lineHeight: 29, marginTop: 5 },
  description: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20, marginTop: 7 },
  meta: { marginTop: 'auto' },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: 9, minHeight: 30 },
  divider: { backgroundColor: colors.line, height: StyleSheet.hairlineWidth, marginVertical: 3 },
  schedule: { color: colors.ink, flex: 1, fontFamily: fontFamily.sansMedium, fontSize: 12, lineHeight: 17 },
  miles: { color: colors.muted, flex: 1, fontFamily: fontFamily.sans, fontSize: 12 },
  swipeStamp: { borderRadius: 8, borderWidth: 2, paddingHorizontal: 10, paddingVertical: 5, position: 'absolute', top: 24 },
  interestedStamp: { borderColor: colors.teal, left: 22, transform: [{ rotate: '-7deg' }] },
  dismissedStamp: { borderColor: colors.danger, right: 22, transform: [{ rotate: '7deg' }] },
  interestedStampText: { color: colors.teal, fontFamily: fontFamily.sansBold, fontSize: 13, letterSpacing: 0.8 },
  dismissedStampText: { color: colors.danger, fontFamily: fontFamily.sansBold, fontSize: 13, letterSpacing: 0.8 },
  actions: { flexDirection: 'row', gap: 12, justifyContent: 'center', paddingHorizontal: 16, paddingTop: 14 },
  action: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 18, borderWidth: 1, flex: 1, height: 56, justifyContent: 'center', maxWidth: 112 },
  actionPrimary: { backgroundColor: colors.teal, borderColor: colors.teal },
  actionPressed: { opacity: 0.78, transform: [{ scale: 0.97 }] },
  undoSlot: { alignItems: 'center', height: 40, justifyContent: 'center' },
  undo: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 7, minHeight: 40, paddingHorizontal: 14 },
  undoText: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 32 },
  stateIcon: { alignItems: 'center', backgroundColor: colors.tint, borderRadius: 999, height: 52, justifyContent: 'center', marginBottom: 13, width: 52 },
  stateTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 22, textAlign: 'center' },
  stateButton: { backgroundColor: colors.ink, borderRadius: 999, marginTop: 18, minHeight: 44, paddingHorizontal: 20, paddingVertical: 12 },
  stateButtonText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 13 },
  pressed: { opacity: 0.75 },
});
