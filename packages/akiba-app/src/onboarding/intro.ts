import * as SecureStore from 'expo-secure-store';

/**
 * Whether this device has already been through the pre-sign-in intro
 * slides (BDR-007). Device-scoped, not member-scoped: the slides explain
 * the app, not an account, so someone signing out and back in — or a
 * second member on the same phone — goes straight to sign-in.
 *
 * Reads are synchronous so the sign-in screen can decide on its first
 * render whether to send a new device to the intro, with no flash of the
 * email form. Like onboarding progress, every failure is swallowed: a
 * keystore that refuses just means the intro shows again.
 */
const INTRO_SEEN_KEY = 'akiba.intro.seen';

export function hasSeenIntro(): boolean {
  try {
    return SecureStore.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export async function markIntroSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(INTRO_SEEN_KEY, '1');
  } catch {
    // Showing the intro twice is harmless.
  }
}
