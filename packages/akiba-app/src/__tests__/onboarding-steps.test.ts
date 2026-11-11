import { describe, expect, it } from 'vitest';

import {
  ONBOARDING_ROUTES,
  ONBOARDING_STEPS,
  isOnboardingStep,
  resolveResumeStep,
  stepIndex,
} from '@/onboarding/steps';

describe('onboarding step order', () => {
  it('is the four setup steps, in order', () => {
    expect(ONBOARDING_STEPS).toEqual(['profile', 'location', 'notifications', 'pass']);
    expect(stepIndex('profile')).toBe(0);
    expect(stepIndex('location')).toBe(1);
    expect(stepIndex('notifications')).toBe(2);
    expect(stepIndex('pass')).toBe(3);
  });

  it('has a route for every step', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(ONBOARDING_ROUTES[step]).toBe(`/onboarding/${step}`);
    }
  });

  it('only recognises real steps as stored progress', () => {
    expect(isOnboardingStep('profile')).toBe(true);
    expect(isOnboardingStep('notifications')).toBe(true);
    // A value left by an older build, or a corrupted keystore read, must
    // not be trusted as a step. 'welcome' was a step before BDR-007.
    expect(isOnboardingStep('welcome')).toBe(false);
    expect(isOnboardingStep('location-permission')).toBe(false);
    expect(isOnboardingStep(null)).toBe(false);
    expect(isOnboardingStep(2)).toBe(false);
  });
});

describe('resolveResumeStep', () => {
  it('starts a brand-new member at the profile', () => {
    expect(resolveResumeStep({ savedStep: null, hasProfile: false })).toBe('profile');
  });

  it('resumes where the member left off after a force-quit', () => {
    expect(resolveResumeStep({ savedStep: 'profile', hasProfile: false })).toBe('profile');
    expect(resolveResumeStep({ savedStep: 'location', hasProfile: true })).toBe('location');
    expect(resolveResumeStep({ savedStep: 'notifications', hasProfile: true })).toBe('notifications');
    expect(resolveResumeStep({ savedStep: 'pass', hasProfile: true })).toBe('pass');
  });

  it('never re-asks for a profile that is already set', () => {
    // Covers both "they just filled it in and the app died" and "they
    // signed up on web, where a username is set outside this flow".
    expect(resolveResumeStep({ savedStep: 'profile', hasProfile: true })).toBe('location');
    expect(resolveResumeStep({ savedStep: null, hasProfile: true })).toBe('location');
  });

  it('falls back to the profile step rather than skipping past missing data', () => {
    expect(resolveResumeStep({ savedStep: 'location', hasProfile: false })).toBe('profile');
    expect(resolveResumeStep({ savedStep: 'notifications', hasProfile: false })).toBe('profile');
    expect(resolveResumeStep({ savedStep: 'pass', hasProfile: false })).toBe('profile');
  });
});
