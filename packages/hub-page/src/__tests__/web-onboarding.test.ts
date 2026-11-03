import { describe, expect, it } from 'vitest';
import { needsWebOnboarding, onboardingReturnPath } from '@/lib/akiba/webOnboarding';

describe('web onboarding cohort', () => {
  it('only prompts future Pass holders without shared completion', () => {
    expect(needsWebOnboarding({ onboarding_required: true, onboarding_seen_at: null })).toBe(true);
    expect(needsWebOnboarding({ onboarding_required: false, onboarding_seen_at: null })).toBe(false);
    expect(needsWebOnboarding({ onboarding_required: true, onboarding_seen_at: '2026-11-03' })).toBe(false);
    expect(needsWebOnboarding(null)).toBe(false);
  });
  it.each(['https://example.com', '//example.com', '/\\example.com', '/\nexample.com', '/welcome?next=/pass', '/auth/continue', '/login', '/join'])('rejects unsafe or looping destinations: %s', path => {
    expect(onboardingReturnPath(path)).toBe('/');
  });
  it('preserves an intended local destination and its query', () => {
    expect(onboardingReturnPath('/merchants/cafe?offer=1')).toBe('/merchants/cafe?offer=1');
  });
});
