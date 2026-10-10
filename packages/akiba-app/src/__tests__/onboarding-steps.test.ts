import { describe, expect, it } from 'vitest';

import {
  ONBOARDING_ROUTES,
  ONBOARDING_STEPS,
  isOnboardingStep,
  resolveResumeStep,
  stepIndex,
} from '@/onboarding/steps';

describe('onboarding step order', () => {
  it('is the three steps the spec defines, in order', () => {
    expect(ONBOARDING_STEPS).toEqual(['welcome', 'profile', 'pass']);
    expect(stepIndex('welcome')).toBe(0);
    expect(stepIndex('profile')).toBe(1);
    expect(stepIndex('pass')).toBe(2);
  });

  it('has a route for every step', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(ONBOARDING_ROUTES[step]).toBe(`/onboarding/${step}`);
    }
  });

  it('only recognises real steps as stored progress', () => {
    expect(isOnboardingStep('profile')).toBe(true);
    // A value left by an older build, or a corrupted keystore read, must
    // not be trusted as a step.
    expect(isOnboardingStep('location-permission')).toBe(false);
    expect(isOnboardingStep(null)).toBe(false);
    expect(isOnboardingStep(2)).toBe(false);
  });
});

describe('resolveResumeStep', () => {
  it('starts a brand-new member at the beginning', () => {
    expect(resolveResumeStep({ savedStep: null, hasProfile: false })).toBe('welcome');
  });

  it('resumes where the member left off after a force-quit', () => {
    expect(resolveResumeStep({ savedStep: 'profile', hasProfile: false })).toBe('profile');
    expect(resolveResumeStep({ savedStep: 'pass', hasProfile: true })).toBe('pass');
  });

  it('never re-asks for a profile that is already set', () => {
    // Covers both "they just filled it in and the app died" and "they
    // signed up on web, where a username is set outside this flow".
    expect(resolveResumeStep({ savedStep: 'profile', hasProfile: true })).toBe('pass');
  });

  it('falls back to the profile step rather than skipping past missing data', () => {
    expect(resolveResumeStep({ savedStep: 'pass', hasProfile: false })).toBe('profile');
  });

  it('leaves the welcome step alone for a member who already has a profile', () => {
    // The welcome step asks for nothing, so there is no reason to skip it —
    // and skipping straight to the last step would be disorienting.
    expect(resolveResumeStep({ savedStep: 'welcome', hasProfile: true })).toBe('welcome');
  });
});
