// Pre-sign-in intro (BDR-007): three slides on what Akiba is for, shown once
// per device before the email screen. Positioning order is deliberate —
// find local places first, getting something back second — and the copy
// avoids loyalty / "earn rewards" framing.
//
// Both "Get started" and "Sign in" lead to the same screen: the email code
// creates an account on first use, so there's no separate sign-up path.
// The sign-in link is there to reassure returning members.
import { useRef, useState } from 'react';
import { router } from 'expo-router';
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  GlowBackground,
  Headline,
  OnboardingFooter,
  OnboardingHeader,
  SecondaryLink,
  visualHeight,
} from '@/components/onboarding/chrome';
import { OfferCardStack, PassCard, PlaceCardStack } from '@/components/onboarding/visuals';
import { markIntroSeen } from '@/onboarding';
import { colors } from '@/design-system';

const SLIDES = [
  {
    key: 'places',
    title: 'Find places\nworth going to',
    body: 'Discover local spots to shop, eat and enjoy near you.',
    visual: <PlaceCardStack />,
  },
  {
    key: 'offers',
    title: 'Get something back',
    body: 'Offers and vouchers at the places you already go.',
    visual: <OfferCardStack />,
  },
  {
    key: 'pass',
    title: 'One Pass,\nevery place',
    body: 'Show your QR Pass, the merchant scans it, done.',
    visual: (
      <PassCard
        code="AKB-9842-8810"
        name="Amani Mwangi"
        qrSize={120}
        qrValue="AKIBA-SAMPLE-NOT-VALID-FOR-REDEMPTION"
        sample
        scannedAt="Kahawa Corner"
      />
    ),
  },
] as const;

export default function IntroScreen() {
  const { width, height } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  // The page area is the screen minus the 20pt gutters the chrome uses, so
  // each slide's content lines up with the header and footer above/below it.
  const pageWidth = Math.min(width, 520 + 40);

  function goTo(next: number) {
    pager.current?.scrollTo({ animated: true, x: next * pageWidth });
    setIndex(next);
  }

  function onScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / pageWidth));
  }

  function toSignIn() {
    void markIntroSeen();
    router.push('/sign-in');
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.shell}>
      <GlowBackground />
      <View style={styles.gutter}>
        <OnboardingHeader
          logo={index === 0}
          onBack={index > 0 ? () => goTo(index - 1) : undefined}
          progress={{ current: index + 1, total: SLIDES.length }}
        />
      </View>

      <ScrollView
        horizontal
        onMomentumScrollEnd={onScrollEnd}
        pagingEnabled
        ref={pager}
        showsHorizontalScrollIndicator={false}
        style={[styles.pager, { width: pageWidth }]}>
        {SLIDES.map((slide) => (
          <View key={slide.key} style={[styles.page, { width: pageWidth }]}>
            <View style={[styles.visual, { height: visualHeight(height) }]}>{slide.visual}</View>
            <Headline body={slide.body} title={slide.title} />
          </View>
        ))}
      </ScrollView>

      <View style={[styles.gutter, styles.bottom]}>
        <OnboardingFooter
          onPrimary={last ? toSignIn : () => goTo(index + 1)}
          primaryHint={`Slide ${index + 1} of ${SLIDES.length}`}
          primaryLabel={last ? 'Get started' : 'Next'}
          secondary={<SecondaryLink emphasis="Sign in" label="Already have an account?" onPress={toSignIn} />}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    flex: 1,
  },
  gutter: {
    maxWidth: 520,
    paddingHorizontal: 20,
    width: '100%',
  },
  bottom: {
    paddingBottom: 24,
  },
  pager: {
    flexGrow: 1,
  },
  page: {
    paddingHorizontal: 20,
  },
  visual: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
});
