import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { createApiClient } from '@/api';
import { track } from '@/analytics';

import { getInstallationId } from './installation';

export type RegistrationOutcome =
  | { status: 'registered'; deviceId?: string }
  | { status: 'denied' }
  | { status: 'unsupported' }
  | { status: 'failed'; reason: 'token' | 'api' };

/**
 * Asks for notification permission if it has not been decided yet, then
 * registers this install's Expo push token with the Hub.
 *
 * Never called at cold start. The caller mounts below the onboarding gate,
 * so the prompt lands after the member has seen what the app is for
 * (AKIBA-MOB-001 §3) rather than on first launch, which is the pattern that
 * gets permanently denied.
 *
 * `getPermissionsAsync` first is what keeps this safe to call on every
 * launch: once the member has answered, this never prompts again, so a
 * re-register after a token rotation costs nothing visible.
 */
export async function registerForPushNotifications(accessToken: string): Promise<RegistrationOutcome> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return { status: 'unsupported' };

  const existing = await Notifications.getPermissionsAsync();
  // iOS provisional authorization counts as permitted — quiet notifications
  // are still delivered, so there is nothing to ask for.
  let granted =
    existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

  if (!granted) {
    // Only ask when iOS still allows it. Re-requesting after a denial is a
    // no-op that returns the denial, so this avoids a pointless round trip
    // and keeps the analytics honest about who was actually asked.
    if (!existing.canAskAgain) return { status: 'denied' };

    track('push_permission_requested');
    const result = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    granted = result.granted || result.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    track(granted ? 'push_permission_granted' : 'push_permission_denied');
  }

  if (!granted) return { status: 'denied' };

  // Android needs the channel to exist before a notification naming it
  // arrives, or the system drops it silently. Creating it here — rather than
  // at module load — keeps it next to the permission it belongs with.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Rewards and account updates',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      sound: 'default',
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== 'string' || !projectId) {
    // Without the EAS project id Expo cannot mint a token for this build.
    // A real misconfiguration, so it is surfaced rather than retried.
    console.error('[push] missing expo.extra.eas.projectId; cannot request a push token');
    return { status: 'failed', reason: 'token' };
  }

  let expoPushToken: string;
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    expoPushToken = token.data;
  } catch (error) {
    // Expo's docs call this out explicitly: minting a token is a network
    // call and fails offline. The provider retries on the next foreground,
    // so this is not an error worth showing anyone.
    console.warn('[push] could not obtain an Expo push token:', error);
    return { status: 'failed', reason: 'token' };
  }

  try {
    const result = await createApiClient({ accessToken }).registerDevice({
      installationId: await getInstallationId(),
      platform: Platform.OS,
      expoPushToken,
      appVersion: Constants.expoConfig?.version ?? null,
      buildNumber:
        Platform.OS === 'ios'
          ? (Constants.expoConfig?.ios?.buildNumber ?? null)
          : String(Constants.expoConfig?.android?.versionCode ?? ''),
      locale: null,
      timezone: null,
    });
    track('push_device_registered');
    return { status: 'registered', deviceId: result.deviceId };
  } catch (error) {
    console.warn('[push] device registration failed:', error);
    return { status: 'failed', reason: 'api' };
  }
}

/**
 * Releases this install's registration. Called on sign-out so the next
 * member on this phone does not inherit the previous one's notifications.
 */
export async function unregisterPushNotifications(accessToken: string): Promise<void> {
  try {
    await createApiClient({ accessToken }).unregisterDevice(await getInstallationId());
  } catch (error) {
    // Best effort: the server also releases a token when it is re-registered
    // under a different account, so a failure here cannot leak
    // notifications to the wrong member.
    console.warn('[push] device unregistration failed:', error);
  }
}
