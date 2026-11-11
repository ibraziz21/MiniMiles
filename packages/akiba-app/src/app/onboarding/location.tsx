// Onboarding step 2 of 4 (BDR-007). Explains why Akiba wants location
// before the system dialog appears, then asks once. Either answer moves on:
// location is only used by "Near me" on the Merchants tab, which still asks
// again there if this was skipped, and copes with a denial by falling back
// to filtering by city.
import { useState } from 'react';
import { router } from 'expo-router';
import * as Location from 'expo-location';

import { SecondaryLink } from '@/components/onboarding/chrome';
import { MapPreview } from '@/components/onboarding/visuals';
import { OnboardingStepScreen } from '@/components/onboarding-step';
import { ONBOARDING_ROUTES } from '@/onboarding';

export default function OnboardingLocationScreen() {
  const [asking, setAsking] = useState(false);

  function next() {
    router.push(ONBOARDING_ROUTES.notifications);
  }

  async function allow() {
    setAsking(true);
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch {
      // A failed request is the same as "Not now" — nothing here depends on it.
    } finally {
      setAsking(false);
      next();
    }
  }

  return (
    <OnboardingStepScreen
      body="We use your location to show places and offers close by. You can change this anytime in Settings."
      layout="showcase"
      onPrimary={() => void allow()}
      primaryBusy={asking}
      primaryBusyLabel="Allow location"
      primaryLabel="Allow location"
      secondary={<SecondaryLink label="Not now" onPress={next} />}
      step="location"
      title="See what’s near you"
      visual={<MapPreview />}
    />
  );
}
