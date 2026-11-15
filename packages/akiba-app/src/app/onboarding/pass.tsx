// Onboarding step 4 of 4 (BDR-007) — the member's own Pass, then into the
// app. This used to be a text-only explainer that deliberately rendered no
// code; it now shows the live Pass QR from the same endpoints as the Pass
// tab, so the first thing a new member sees is the thing they'll use.
//
// Arriving here asks the server for the new-member welcome offer (BDR-008).
// The welcome variant shows only when the answer is a voucher that has
// already been issued — never a promise, so the 1,001st member is never
// shown "25% OFF". Anything else, including a slow or failed answer, is the
// plain "Your Pass is ready" screen.
import { useEffect, useState } from 'react';
import { router, type Href } from 'expo-router';
import { ActivityIndicator, StyleSheet, View, useWindowDimensions } from 'react-native';

import { track } from '@/analytics';
import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import { SecondaryLink, visualHeight } from '@/components/onboarding/chrome';
import { PassCard, WelcomeVoucherTicket } from '@/components/onboarding/visuals';
import { OnboardingStepScreen } from '@/components/onboarding-step';
import type { AwardedWelcomeOffer } from '@/contracts/welcome-offer';
import { colors } from '@/design-system';
import { useMember } from '@/member';
import { clearOnboardingStep } from '@/onboarding';

type PassDetails = { code: string | null; qr: string | null };

/** Loads the Pass ID and a live QR token; failures leave a spinner, never a dead end. */
function usePassDetails(accessToken: string | null): PassDetails {
  const [details, setDetails] = useState<PassDetails>({ code: null, qr: null });

  useEffect(() => {
    if (!accessToken) return;
    const client = createApiClient({ accessToken });
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void client
      .getPass()
      .then((pass) => {
        if (active) setDetails((current) => ({ ...current, code: pass.publicPassId }));
      })
      .catch(() => undefined);

    // The presentation token is short-lived; refresh it shortly before it
    // expires so the code on screen stays scannable if the member lingers.
    const loadToken = () => {
      void client
        .getPassPresentation()
        .then((presentation) => {
          if (!active) return;
          setDetails((current) => ({ ...current, qr: presentation.token }));
          const refreshIn = Date.parse(presentation.expiresAt) - Date.now() - 30_000;
          timer = setTimeout(loadToken, Math.max(5_000, refreshIn));
        })
        .catch(() => undefined);
    };
    loadToken();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [accessToken]);

  return details;
}

// Long enough for a normal answer, short enough that a stalled request
// never holds a new member on a spinner.
const WELCOME_OFFER_WAIT_MS = 5_000;

type WelcomeOfferCheck = { status: 'checking' } | { status: 'done'; offer: AwardedWelcomeOffer | null };

/** Enrols the member once on arrival; resolves to the issued offer or null. */
function useWelcomeOffer(accessToken: string | null): WelcomeOfferCheck {
  const [check, setCheck] = useState<WelcomeOfferCheck>({ status: 'checking' });

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    const settle = (offer: AwardedWelcomeOffer | null) => {
      if (active) setCheck((current) => (current.status === 'checking' ? { status: 'done', offer } : current));
    };
    const timer = setTimeout(() => settle(null), WELCOME_OFFER_WAIT_MS);
    void createApiClient({ accessToken })
      .enrolWelcomeOffer()
      .then((offer) => settle(offer.state === 'awarded' ? { ...offer, state: 'awarded' } : null))
      .catch(() => settle(null));
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [accessToken]);

  return check;
}

export default function OnboardingPassScreen() {
  const { accessToken } = useAuth();
  const { state, completeOnboarding } = useMember();
  const { height } = useWindowDimensions();
  const { code, qr } = usePassDetails(accessToken);
  const welcome = useWelcomeOffer(accessToken);
  const offer = welcome.status === 'done' ? welcome.offer : null;
  const [finishing, setFinishing] = useState<Href | null>(null);
  const [error, setError] = useState<string | null>(null);

  const user = state.status === 'ready' ? state.bootstrap.user : null;
  // Leave room in the visual block for the card's header, name and code.
  const qrSize = Math.max(96, Math.min(132, visualHeight(height) - 176));

  async function finish(destination: Href) {
    setFinishing(destination);
    setError(null);
    try {
      await completeOnboarding();
      track('onboarding_completed', { welcomeVoucher: !!offer });
      if (user) {
        // Local resume state has done its job once the server records the
        // completion; leaving it behind would be harmless but stale.
        await clearOnboardingStep(user.id);
      }
      router.replace(destination);
    } catch {
      // Never strand a member on the last step with no way forward: the
      // completion call is idempotent, so retrying is always safe.
      setError('We couldn’t save your progress. Check your connection and try again.');
      setFinishing(null);
    }
  }

  const pass = (
    <PassCard
      code={code}
      handle={user?.username}
      name={user?.displayName || user?.username || 'Akiba member'}
      qrSize={offer ? 72 : qrSize}
      qrValue={qr}
    />
  );

  if (welcome.status === 'checking') {
    return (
      <OnboardingStepScreen
        body="This only takes a moment."
        layout="showcase"
        onPrimary={() => undefined}
        primaryBusy
        primaryBusyLabel="One moment…"
        primaryLabel="Start exploring"
        step="pass"
        title="Getting your Pass ready"
        visual={<ActivityIndicator color={colors.teal} size="large" />}
      />
    );
  }

  if (offer) {
    return (
      <OnboardingStepScreen
        body={`${offer.discountPercent}% off one bill of KES ${offer.minimumSpendKes.toLocaleString('en-KE')} or more in your first 7 days. Show your Pass at a participating place to use it.`}
        error={error}
        layout="showcase"
        onPrimary={() => void finish('/merchants')}
        primaryBusy={finishing === '/merchants'}
        primaryBusyLabel="Finishing up…"
        primaryDisabled={!!finishing}
        primaryLabel="Find a place to use it"
        secondary={<SecondaryLink label="Start exploring" onPress={() => void finish('/')} />}
        step="pass"
        title="Welcome to Akiba"
        visual={
          <View style={styles.voucherStack}>
            <View style={styles.voucherOnTop}>
              <WelcomeVoucherTicket
                discountPercent={offer.discountPercent}
                expiresAt={offer.expiresAt}
                maximumDiscountKes={offer.maximumDiscountKes}
                minimumSpendKes={offer.minimumSpendKes}
              />
            </View>
            <View style={styles.passBehind}>{pass}</View>
          </View>
        }
      />
    );
  }

  return (
    <OnboardingStepScreen
      body="Show it when you pay so the place can scan it."
      error={error}
      layout="showcase"
      onPrimary={() => void finish('/')}
      primaryBusy={!!finishing}
      primaryBusyLabel="Finishing up…"
      primaryLabel="Start exploring"
      step="pass"
      title="Your Pass is ready"
      visual={pass}
    />
  );
}

const styles = StyleSheet.create({
  voucherStack: {
    alignItems: 'center',
  },
  voucherOnTop: {
    transform: [{ rotate: '-2deg' }],
    zIndex: 2,
  },
  passBehind: {
    marginTop: -24,
    zIndex: 1,
  },
});
