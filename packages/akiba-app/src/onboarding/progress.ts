import * as SecureStore from 'expo-secure-store';

import { isOnboardingStep, type OnboardingStep } from './steps';

/**
 * Per-member record of the furthest onboarding step reached, so force-
 * quitting the app mid-flow resumes instead of restarting (AKIBA-MOB-001
 * §4 "An interrupted user resumes at the appropriate step").
 *
 * *Completion* is server state — this is only the in-flight position, and
 * it is keyed by user id so two accounts on one device can't inherit each
 * other's progress. SecureStore (rather than a plain key-value store) is
 * used because it's already this app's only persistence dependency; the
 * value itself isn't a secret.
 *
 * Every read and write swallows its failure: a device that refuses the
 * keystore must still be able to onboard, just without resume.
 */
const KEY_PREFIX = 'akiba.onboarding.step';

function keyFor(userId: string): string {
  // SecureStore keys allow alphanumerics, '.', '-' and '_'. Supabase user
  // ids are UUIDs, which satisfy that, but normalize anyway rather than
  // trusting the shape of an id from the server.
  return `${KEY_PREFIX}.${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export async function loadOnboardingStep(userId: string): Promise<OnboardingStep | null> {
  try {
    const stored = await SecureStore.getItemAsync(keyFor(userId));
    return isOnboardingStep(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function saveOnboardingStep(userId: string, step: OnboardingStep): Promise<void> {
  try {
    await SecureStore.setItemAsync(keyFor(userId), step);
  } catch {
    // Resume is a convenience, never a precondition — see above.
  }
}

export async function clearOnboardingStep(userId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(keyFor(userId));
  } catch {
    // Same reasoning: a stale key is harmless once the server says complete.
  }
}
