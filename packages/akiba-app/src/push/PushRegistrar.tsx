import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';

import { track } from '@/analytics';
import { useAuth } from '@/auth';
import { useMember } from '@/member';

import { notificationRouteShape, resolveNotificationRoute } from './deep-link';
import { registerForPushNotifications } from './register';

/**
 * Decides whether an incoming notification is shown while the app is in the
 * foreground. Set at module scope because expo-notifications expects a
 * handler to exist before any notification can arrive, including one that
 * wakes the app.
 *
 * Banners are shown even in the foreground: these are transactional (Miles
 * credited, voucher ready), so a member looking at another tab should still
 * see them. No badge — the app has no unread model to keep a count honest
 * (`unreadNotificationCount` is still absent from bootstrap).
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Registers this install for push and routes notification taps.
 *
 * Renders nothing, and mounts inside the tabs layout rather than the root
 * layout on purpose: everything above it has already been established by the
 * route guards — there is a session, bootstrap loaded, and onboarding is
 * complete — so the permission prompt cannot land on a cold start or on a
 * member who has not yet seen what the app does.
 *
 * Gated on `capabilities.nativePush`, which the Hub sets from the same
 * switch its dispatcher reads. A deployment that cannot send never asks for
 * permission and never collects a token.
 */
export function PushRegistrar() {
  const { accessToken } = useAuth();
  const { state } = useMember();
  const nativePush = state.status === 'ready' ? state.bootstrap.capabilities.nativePush : false;
  // Null until an attempt has been made for this token; then whether it
  // succeeded. A success is what stops further attempts — a failure is
  // deliberately left retryable, because the usual cause is being offline
  // when the token was minted.
  const registered = useRef<{ token: string; done: boolean } | null>(null);
  const handledResponses = useRef(new Set<string>());

  const attemptRegistration = useCallback(async () => {
    if (!nativePush || !accessToken) return;
    if (registered.current?.token === accessToken && registered.current.done) return;

    const outcome = await registerForPushNotifications(accessToken);
    // 'denied' and 'unsupported' are settled answers, not transient ones:
    // retrying either would never prompt again and never mint a token.
    const settled = outcome.status === 'registered' || outcome.status === 'denied' || outcome.status === 'unsupported';
    registered.current = { token: accessToken, done: settled };
  }, [accessToken, nativePush]);

  // ── Registration ──────────────────────────────────────────────────────
  useEffect(() => {
    void attemptRegistration();
  }, [attemptRegistration]);

  // A token mint that failed offline is worth another try when the app comes
  // back, since that is the moment connectivity usually returns. Once
  // attemptRegistration has a settled answer this is a no-op, so it does not
  // re-hit Expo's token endpoint on every foreground.
  useEffect(() => {
    if (!nativePush || !accessToken) return;

    const subscription = AppState.addEventListener('change', (status) => {
      if (status !== 'active') return;
      void attemptRegistration();
    });
    return () => subscription.remove();
  }, [accessToken, attemptRegistration, nativePush]);

  // ── Taps ──────────────────────────────────────────────────────────────
  const open = useCallback((response: Notifications.NotificationResponse) => {
    // A cold-start tap can arrive twice — once from
    // getLastNotificationResponse below and once from the listener — and two
    // navigations would stack the same screen. Keyed on the notification's
    // own identifier so a genuinely new tap is never swallowed.
    const id = response.notification.request.identifier;
    if (handledResponses.current.has(id)) return;
    handledResponses.current.add(id);
    openFromNotification(response.notification.request.content.data);
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [open]);

  useEffect(() => {
    // Cold start from a notification tap: by the time the listener above
    // subscribes, the response that launched the app has already been
    // delivered. `getLastNotificationResponse` is synchronous in SDK 57 and
    // keeps returning the same response until cleared, so clearing it is
    // what stops a re-navigation on a later mount.
    const last = Notifications.getLastNotificationResponse();
    if (!last) return;
    open(last);
    Notifications.clearLastNotificationResponse();
  }, [open]);

  return null;
}

function openFromNotification(data: unknown): void {
  const deepLink =
    data && typeof data === 'object' && 'url' in data ? (data as { url?: unknown }).url : undefined;

  const route = resolveNotificationRoute(deepLink);
  const category =
    data && typeof data === 'object' && 'category' in data
      ? (data as { category?: unknown }).category
      : undefined;

  track('push_notification_opened', {
    // The route *shape*, never the resolved path: a resolved route can embed
    // a voucher template id, which §14 bars from events.
    route: notificationRouteShape(route),
    category: typeof category === 'string' ? category : undefined,
  });

  router.push(route as Href);
}
