import { createApiClient } from '@/api';
import type { TestPushResult } from '@/contracts';

import { registerForPushNotifications, type RegistrationOutcome } from './register';

/**
 * Settings → "Send a test notification": registers this phone (asking for
 * permission if it hasn't been answered — the member just asked for a
 * notification, so this is the right moment), then asks the Hub to push to
 * it for real. Unlike sendTestNotification (local, development only), this
 * goes through Expo and Apple/Google, so it tests the whole chain.
 */
export async function runPushTest(accessToken: string): Promise<{ title: string; message: string }> {
  const registration = await registerForPushNotifications(accessToken, { prompt: true });
  const early = registrationProblem(registration);
  if (early) return early;

  try {
    return describeTestPush(await createApiClient({ accessToken }).sendTestPush());
  } catch {
    return { title: 'Couldn’t send a test', message: 'Check your connection and try again.' };
  }
}

/** Problems on the phone itself, before anything is sent. */
export function registrationProblem(outcome: RegistrationOutcome): { title: string; message: string } | null {
  switch (outcome.status) {
    case 'denied':
      return {
        title: 'Notifications are off',
        message: 'Turn on notifications for Akiba in your phone’s settings, then try again.',
      };
    case 'unsupported':
      return { title: 'Not available here', message: 'Push notifications need the Akiba app on a phone.' };
    case 'failed':
      return {
        title: 'This phone isn’t registered yet',
        message:
          outcome.reason === 'token'
            ? 'We couldn’t get a notification address for this phone. Check your connection and try again.'
            : 'We couldn’t register this phone with Akiba. Try again in a moment.',
      };
    default:
      return null;
  }
}

/** What the server's answer means for the member. Pure, so it is unit-tested. */
export function describeTestPush(result: TestPushResult): { title: string; message: string } {
  switch (result.status) {
    case 'sent':
      return {
        title: 'Test sent',
        message:
          'It should arrive in a few seconds. If it doesn’t show up within a minute, let us know — the problem is on our side.',
      };
    case 'no_devices':
      return {
        title: 'This phone isn’t registered',
        message: 'Close and reopen Akiba, then try again.',
      };
    case 'push_disabled':
      return {
        title: 'Notifications are paused',
        message: 'Akiba isn’t sending push notifications right now. Please try again later.',
      };
    case 'failed':
      return {
        title: 'The test didn’t go through',
        message: result.errors.some((error) => error.startsWith('DeviceNotRegistered'))
          ? 'This phone’s notification address has expired. Close and reopen Akiba, then try again.'
          : 'Our notification service refused the message. Please try again later.',
      };
  }
}
