/**
 * The four post-sign-in onboarding steps and the rule for where a member
 * re-enters them (AKIBA-MOB-001 §3/§4, reshaped by BDR-007).
 *
 * What Akiba is for is explained by the intro slides *before* sign-in
 * (`(auth)/intro`), so the setup flow starts straight at the profile.
 *
 * Pure so it can be unit-tested without a device: everything it needs —
 * the last step the member reached, and whether their profile is already
 * set — is passed in.
 */
export const ONBOARDING_STEPS = ['profile', 'location', 'notifications', 'pass'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value);
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

export const ONBOARDING_ROUTES = {
  profile: '/onboarding/profile',
  location: '/onboarding/location',
  notifications: '/onboarding/notifications',
  pass: '/onboarding/pass',
} as const satisfies Record<OnboardingStep, string>;

/**
 * Where to put a member who is starting, or coming back to, onboarding.
 *
 * - No saved step: start at the beginning.
 * - A saved step: resume there, so killing the app mid-flow doesn't restart it.
 *   A step saved by an older build ('welcome') isn't a step any more, so it
 *   reads as null and starts from the beginning.
 * - Profile already set: never ask for it again — the §4 rule that profile
 *   fields saved during onboarding are not re-requested. This also covers
 *   someone who signed up on web, where a username is set outside this flow.
 * - Saved step past the profile step but no profile yet: fall back to it,
 *   so a member can't end up at a later step with the profile missing.
 */
export function resolveResumeStep(input: {
  savedStep: OnboardingStep | null;
  hasProfile: boolean;
}): OnboardingStep {
  const step = input.savedStep ?? 'profile';
  if (step === 'profile' && input.hasProfile) return 'location';
  if (step !== 'profile' && !input.hasProfile) return 'profile';
  return step;
}
