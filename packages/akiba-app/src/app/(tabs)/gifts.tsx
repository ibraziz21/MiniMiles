import { useRef, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ProfileButton } from '@/components/profile-button';
import { Icon, colors, fontFamily, shadows } from '@/design-system';

const STEPS = [
  { icon: 'shopping-bag' as const, title: 'Choose a place', body: 'Pick an Akiba merchant or experience.' },
  { icon: 'send' as const, title: 'Make it personal', body: 'Add a message and send it straight to them.' },
  { icon: 'check-circle' as const, title: 'Easy to redeem', body: 'They keep it in Akiba and use it with the merchant.' },
];

const SLIDE_COUNT = 2;

export default function GiftsScreen() {
  const { width } = useWindowDimensions();
  const [slideIndex, setSlideIndex] = useState(0);
  const heroRailRef = useRef<ScrollView>(null);
  const wide = width >= 700;
  const slideWidth = Math.min(width, 760) - 32;
  const slideGap = 12;
  const slideStep = slideWidth + slideGap;
  const slideMinHeight = wide ? 400 : 440;

  function goToSlide(index: number) {
    const next = Math.max(0, Math.min(SLIDE_COUNT - 1, index));
    heroRailRef.current?.scrollTo({ animated: true, x: next * slideStep });
    setSlideIndex(next);
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page} style={styles.screen}>
      <View style={styles.screenHeader}>
        <Text style={styles.screenTitle}>Gifts</Text>
        <ProfileButton />
      </View>

      <View style={styles.heroCarousel}>
        <ScrollView
          ref={heroRailRef}
          accessibilityLabel="Akiba Gifts preview"
          horizontal
          decelerationRate="fast"
          disableIntervalMomentum
          nestedScrollEnabled
          onMomentumScrollEnd={(event) => {
            const next = Math.round(event.nativeEvent.contentOffset.x / slideStep);
            setSlideIndex(Math.max(0, Math.min(SLIDE_COUNT - 1, next)));
          }}
          showsHorizontalScrollIndicator={false}
          snapToAlignment="start"
          snapToInterval={slideStep}
          contentContainerStyle={styles.heroRail}>
          <LinearGradient
          accessibilityLabel="Coming soon in Kenya. Give them somewhere worth going. Merchant gift cards and memorable experiences are coming to Akiba."
          accessible
          colors={[colors.tealDark, colors.teal]}
          style={[styles.hero, { minHeight: slideMinHeight, width: slideWidth }, wide && styles.heroWide]}>
          <View style={styles.heroCopy}>
            <View style={styles.comingBadge}>
              <View style={styles.badgeDot} />
              <Text style={styles.comingBadgeText}>COMING SOON IN KENYA</Text>
            </View>
            <Text style={styles.heroTitle}>Give them somewhere worth going.</Text>
            <Text style={styles.heroBody}>Merchant gift cards and memorable experiences are coming to Akiba.</Text>
          </View>

          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.giftVisual}>
            <View style={styles.backCard} />
            <LinearGradient colors={[colors.white, '#EDF9FA']} style={styles.giftCard}>
              <View style={styles.giftCardTop}>
                <View style={styles.giftIcon}><Icon name="gift" size={22} color={colors.white} /></View>
                <Text style={styles.giftCardBrand}>AKIBA</Text>
              </View>
              <Text style={styles.giftCardLabel}>A gift for you</Text>
              <View style={styles.giftCardLine} />
              <Text style={styles.giftCardNote}>Made for a place they’ll love</Text>
            </LinearGradient>
          </View>
          </LinearGradient>

          <LinearGradient
            colors={[colors.teal, colors.tealDark]}
            style={[styles.hero, styles.howHero, { minHeight: slideMinHeight, width: slideWidth }]}>
            <View>
              <View style={styles.comingBadge}>
                <View style={styles.badgeDot} />
                <Text style={styles.comingBadgeText}>HOW IT WILL WORK</Text>
              </View>
              <Text style={styles.howTitle}>A better kind of gift card.</Text>
              <Text style={styles.howBody}>Built around real merchants and experiences—not a generic cash balance.</Text>
            </View>

            <View style={styles.steps}>
              {STEPS.map((step, index) => (
                <View
                  accessibilityLabel={`Step ${index + 1}. ${step.title}. ${step.body}`}
                  accessible
                  key={step.title}
                  style={styles.stepRow}>
                  <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
                  <View style={styles.stepIcon}><Icon name={step.icon} size={18} color={colors.teal} /></View>
                  <View style={styles.stepCopy}>
                    <Text style={styles.stepTitle}>{step.title}</Text>
                    <Text style={styles.stepBody}>{step.body}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.launchNote}>
              <Icon name="map-pin" size={15} color={colors.white} />
              <Text style={styles.launchNoteText}>Launching with selected merchants in Kenya.</Text>
            </View>
          </LinearGradient>
        </ScrollView>

        <Pressable
          accessibilityLabel={slideIndex === 0 ? 'Show how Akiba Gifts will work' : 'Return to the Akiba Gifts preview'}
          accessibilityRole="button"
          onPress={() => goToSlide(slideIndex === 0 ? 1 : 0)}
          style={({ pressed }) => [styles.carouselCue, pressed && styles.carouselCuePressed]}>
          <View style={styles.carouselDots}>
            {Array.from({ length: SLIDE_COUNT }).map((_, index) => <View key={index} style={[styles.carouselDot, index === slideIndex && styles.carouselDotActive]} />)}
          </View>
          <Text style={styles.swipeHint}>{slideIndex === 0 ? 'Swipe for how it works' : 'Back to gift preview'}</Text>
          <Icon name={slideIndex === 0 ? 'arrow-right' : 'arrow-left'} size={15} color={colors.white} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.paper },
  page: { alignSelf: 'center', maxWidth: 760, padding: 16, paddingBottom: 36, width: '100%' },
  screenHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  screenTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 28, lineHeight: 34 },
  heroCarousel: { position: 'relative' },
  heroRail: { gap: 12 },
  hero: { borderCurve: 'continuous', borderRadius: 28, gap: 28, justifyContent: 'space-between', overflow: 'hidden', padding: 22, paddingBottom: 66 },
  heroWide: { alignItems: 'center', flexDirection: 'row', padding: 32 },
  heroCopy: { flex: 1, maxWidth: 430 },
  comingBadge: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.10)', borderColor: 'rgba(255,255,255,0.20)', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 7, minHeight: 30, paddingHorizontal: 11 },
  badgeDot: { backgroundColor: '#8ED2D9', borderRadius: 999, height: 7, width: 7 },
  comingBadgeText: { color: '#E6FAFC', fontFamily: fontFamily.sansBold, fontSize: 9, letterSpacing: 1.1 },
  heroTitle: { color: colors.white, fontFamily: fontFamily.sterlingSemiBold, fontSize: 32, lineHeight: 37, marginTop: 18, maxWidth: 360 },
  heroBody: { color: 'rgba(255,255,255,0.76)', fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 21, marginTop: 10, maxWidth: 390 },
  giftVisual: { alignSelf: 'center', height: 160, justifyContent: 'center', width: 245 },
  backCard: { backgroundColor: '#8ED2D9', borderCurve: 'continuous', borderRadius: 22, height: 132, left: 24, opacity: 0.72, position: 'absolute', top: 5, transform: [{ rotate: '7deg' }], width: 205 },
  giftCard: { ...shadows.soft, borderCurve: 'continuous', borderRadius: 22, height: 138, justifyContent: 'space-between', padding: 16, transform: [{ rotate: '-3deg' }], width: 218 },
  giftCardTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  giftIcon: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 999, height: 40, justifyContent: 'center', width: 40 },
  giftCardBrand: { color: colors.teal, fontFamily: fontFamily.sansBold, fontSize: 10, letterSpacing: 1.3 },
  giftCardLabel: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 21 },
  giftCardLine: { backgroundColor: 'rgba(35,141,157,0.25)', height: 1 },
  giftCardNote: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 9 },
  howHero: { gap: 12, padding: 20 },
  howTitle: { color: colors.white, fontFamily: fontFamily.sterlingSemiBold, fontSize: 26, lineHeight: 30, marginTop: 13 },
  howBody: { color: 'rgba(255,255,255,0.76)', fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 18, marginTop: 5 },
  steps: { gap: 8 },
  stepRow: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.11)', borderColor: 'rgba(255,255,255,0.18)', borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 9, minHeight: 60, padding: 8 },
  stepNumber: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, height: 26, justifyContent: 'center', width: 26 },
  stepNumberText: { color: colors.white, fontFamily: fontFamily.sansBold, fontSize: 11 },
  stepIcon: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 11, height: 38, justifyContent: 'center', width: 38 },
  stepCopy: { flex: 1 },
  stepTitle: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 13 },
  stepBody: { color: 'rgba(255,255,255,0.72)', fontFamily: fontFamily.sans, fontSize: 11, lineHeight: 16, marginTop: 1 },
  launchNote: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  launchNoteText: { color: colors.white, fontFamily: fontFamily.sansMedium, fontSize: 11 },
  carouselCue: { alignItems: 'center', alignSelf: 'center', backgroundColor: 'rgba(0,86,98,0.72)', borderColor: 'rgba(255,255,255,0.24)', borderRadius: 999, borderWidth: 1, bottom: 14, flexDirection: 'row', gap: 9, height: 40, paddingHorizontal: 14, position: 'absolute' },
  carouselCuePressed: { backgroundColor: 'rgba(0,86,98,0.90)' },
  carouselDots: { alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'center' },
  carouselDot: { backgroundColor: 'rgba(255,255,255,0.40)', borderRadius: 999, height: 6, width: 6 },
  carouselDotActive: { backgroundColor: colors.white, width: 18 },
  swipeHint: { color: colors.white, fontFamily: fontFamily.sansMedium, fontSize: 11 },
});
