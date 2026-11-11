import { useEffect, useRef, type ComponentProps } from 'react';
import { router } from 'expo-router';

import { track } from '@/analytics';
import { useMember } from '@/member';
import {
  ONBOARDING_ROUTES,
  ONBOARDING_STEPS,
  saveOnboardingStep,
  stepIndex,
  type OnboardingStep,
} from '@/onboarding';

import { OnboardingScreen } from './onboarding/chrome';

type OnboardingStepScreenProps = Omit<
  ComponentProps<typeof OnboardingScreen>,
  'logo' | 'onBack' | 'progress' | 'primaryHint'
> & {
  step: OnboardingStep;
};

/**
 * Shared chrome for the four setup steps (AKIBA-MOB-001 §3, BDR-007).
 *
 * Two behaviours live here so each step can't forget them: viewing a step
 * records it as the resume point (§4 — force-quitting mid-flow comes back
 * to the same place), and emits `onboarding_step_viewed`.
 *
 * Back goes to the previous step. The first step has nowhere to go back to
 * (sign-in is behind the auth guard by now), and the last has nothing worth
 * going back for — both permission questions are already answered.
 *
 * Nothing in this flow depends on animation, which is how §5's "usable
 * without animation" is satisfied — not by detecting a reduce-motion
 * setting, but by never depending on motion in the first place.
 */
export function OnboardingStepScreen({ step, ...screen }: OnboardingStepScreenProps) {
  const { state } = useMember();
  const userId = state.status === 'ready' ? state.bootstrap.user.id : null;
  const announced = useRef<OnboardingStep | null>(null);
  const index = stepIndex(step);
  const position = index + 1;
  const total = ONBOARDING_STEPS.length;
  const previous = index > 0 && position < total ? ONBOARDING_STEPS[index - 1] : null;

  useEffect(() => {
    if (announced.current === step) return;
    announced.current = step;
    track('onboarding_step_viewed', { step, position, total });
  }, [step, position, total]);

  useEffect(() => {
    if (!userId) return;
    void saveOnboardingStep(userId, step);
  }, [userId, step]);

  return (
    <OnboardingScreen
      {...screen}
      onBack={
        previous
          ? () => (router.canGoBack() ? router.back() : router.replace(ONBOARDING_ROUTES[previous]))
          : undefined
      }
      primaryHint={`Step ${position} of ${total}`}
      progress={{ current: position, total }}
    />
  );
}
