// Resume resolver: decides which step a member re-enters onboarding at
// (AKIBA-MOB-001 §4) before anything is rendered, so a force-quit mid-flow
// doesn't restart it and a profile that's already set is never re-asked.
// Reading saved progress is an async keystore call, hence the dedicated
// screen rather than a decision inline in a guard.
import { useEffect, useRef } from 'react';
import { router } from 'expo-router';

import { track } from '@/analytics';
import { LaunchLoadingScreen } from '@/components/launch-screens';
import { useMember } from '@/member';
import { ONBOARDING_ROUTES, loadOnboardingStep, resolveResumeStep } from '@/onboarding';

export default function OnboardingEntryScreen() {
  const { state } = useMember();
  const resolved = useRef(false);

  useEffect(() => {
    if (state.status !== 'ready' || resolved.current) return;
    resolved.current = true;

    const { id, username } = state.bootstrap.user;
    let active = true;

    void (async () => {
      const savedStep = await loadOnboardingStep(id);
      if (!active) return;
      const step = resolveResumeStep({ savedStep, hasProfile: !!username });
      // Only a genuine first entry counts as a start; coming back mid-flow
      // would otherwise inflate the funnel's top.
      if (!savedStep) track('onboarding_started');
      router.replace(ONBOARDING_ROUTES[step]);
    })();

    return () => {
      active = false;
    };
  }, [state]);

  return <LaunchLoadingScreen message="Setting up Akiba Pass…" />;
}
