import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Fires a **local** notification shaped exactly like a real earned-Miles
 * push, for testing the on-device half of the chain without Expo Push
 * credentials.
 *
 * What this genuinely proves: notification permission, the Android channel,
 * the foreground handler and banner, the tap listener, and the deep-link
 * whitelist routing to the right screen. In other words everything in the
 * app, end to end.
 *
 * What it cannot prove: that Expo accepted the send, that APNs/FCM
 * credentials are configured, or that the device token registered. A local
 * notification never leaves the phone — it is scheduled by the OS. Do not
 * read a working test here as "push works".
 *
 * `data` mirrors buildPushPayload() in hub-page (src/lib/push/payload.ts)
 * field for field, so the tap takes the same path a real notification does
 * rather than a simplified one that could hide a routing bug.
 *
 * Development builds only — see the __DEV__ guard at the call site.
 */
export async function sendTestNotification(
  deepLink = '/vouchers/purchase/test-template',
): Promise<{ ok: true } | { ok: false; reason: 'denied' | 'failed' }> {
  const permission = await Notifications.getPermissionsAsync();
  const granted =
    permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!granted) return { ok: false, reason: 'denied' };

  // The real sender names this channel, so a channel bug has to show up here
  // too rather than only in production.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Rewards and account updates',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      sound: 'default',
    });
  }

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'You earned 250 Miles 🎉',
        body: 'From Java House. Only 150 more to unlock a free coffee.',
        sound: 'default',
        data: {
          v: 1,
          notificationId: `local-test-${Date.now()}`,
          title: 'You earned 250 Miles 🎉',
          body: 'From Java House. Only 150 more to unlock a free coffee.',
          url: deepLink,
          tag: 'notification:local-test',
          category: 'earnings',
        },
      },
      // null fires immediately; a trigger would only add a delay to wait out.
      trigger: null,
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
