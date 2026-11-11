// Onboarding step 3 of 4 (BDR-007). The push permission prompt used to fire
// from PushRegistrar as soon as the tabs mounted, with no explanation. It is
// asked here instead, behind a screen that says what the notifications are
// for. "Not now" is remembered so the registrar doesn't raise the same
// system prompt a moment later; the member can still turn them on in Settings.
import { useState } from 'react';
import { router } from 'expo-router';

import { useAuth } from '@/auth';
import { SecondaryLink } from '@/components/onboarding/chrome';
import { NotificationStack } from '@/components/onboarding/visuals';
import { OnboardingStepScreen } from '@/components/onboarding-step';
import { useMember } from '@/member';
import { ONBOARDING_ROUTES } from '@/onboarding';
import { deferPushPrompt, registerForPushNotifications } from '@/push';

export default function OnboardingNotificationsScreen() {
  const { accessToken } = useAuth();
  const { state } = useMember();
  const userId = state.status === 'ready' ? state.bootstrap.user.id : null;
  const nativePush = state.status === 'ready' ? state.bootstrap.capabilities.nativePush : false;
  const [asking, setAsking] = useState(false);

  function next() {
    router.push(ONBOARDING_ROUTES.pass);
  }

  async function turnOn() {
    setAsking(true);
    try {
      // Asks, and registers the device if granted. With native push switched
      // off server-side there is nothing to register, so it's skipped and the
      // registrar will ask later once it's on.
      if (nativePush && accessToken) await registerForPushNotifications(accessToken);
    } catch {
      // Registration retries on the next foreground; never block onboarding.
    } finally {
      setAsking(false);
      next();
    }
  }

  function notNow() {
    if (userId) void deferPushPrompt(userId);
    next();
  }

  return (
    <OnboardingStepScreen
      body="Get a heads-up when a place you like has something for you."
      layout="showcase"
      onPrimary={() => void turnOn()}
      primaryBusy={asking}
      primaryBusyLabel="Turn on notifications"
      primaryLabel="Turn on notifications"
      secondary={<SecondaryLink label="Not now" onPress={notNow} />}
      step="notifications"
      title="Never miss an offer"
      visual={<NotificationStack />}
    />
  );
}
