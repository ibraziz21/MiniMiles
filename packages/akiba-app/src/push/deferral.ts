import * as SecureStore from 'expo-secure-store';

/**
 * Records that a member tapped "Not now" on the onboarding notifications
 * step, so PushRegistrar doesn't immediately raise the system prompt they
 * just declined the moment the tabs mount. Keyed by user id, like
 * onboarding progress, so a second account on the phone gets its own
 * answer. Members who finished onboarding on web never saw the step, have
 * no record, and keep being asked once by the registrar as before.
 */
const KEY_PREFIX = 'akiba.push.deferred';

function keyFor(userId: string): string {
  return `${KEY_PREFIX}.${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export function hasDeferredPushPrompt(userId: string): boolean {
  try {
    return SecureStore.getItem(keyFor(userId)) === '1';
  } catch {
    return false;
  }
}

export async function deferPushPrompt(userId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(keyFor(userId), '1');
  } catch {
    // Worst case the registrar asks once more after onboarding.
  }
}
