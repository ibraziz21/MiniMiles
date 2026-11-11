import { notificationRouteShape } from '@/push/deep-link';

import type { AnalyticsEvent, AnalyticsProps } from './events';
import { sendFirebaseEvent, sendFirebaseScreenView } from './firebase';

/**
 * Single analytics call site for the native app, mirroring hub-page's
 * src/lib/analytics/track.ts: events log in development and go to Firebase
 * Analytics in release builds (./firebase.ts). Having one call site is the
 * point — it's also where the §6
 * "do not send email addresses, OTPs, access tokens, or precise
 * coordinates" rule is enforced, so no screen can leak PII by forgetting.
 */

// Key names that must never carry a value, regardless of what's in them.
// The list is the union of MOB-001 §6 (no emails, OTPs, tokens, precise
// coordinates) and MOB-002 §14, which additionally bars user id, request id,
// voucher id, wallet address, and balance.
// Coordinate keys are anchored rather than matched as substrings: a bare
// /lat/ also matches "platform", which §14 explicitly allows.
const BLOCKED_KEY =
  /email|otp|token|password|secret|phone|coord|address|wallet|balance|(^|_)lat(itude)?$|(^|_)(lng|lon|longitude)$|(^|_)(user|request|voucher|member)_?id$/i;

// `code` keys are blocked because a verification code must never be sent —
// except the bounded error/failure codes §14 explicitly allows, which are
// the whole point of the failure events.
const CODE_KEY = /code/i;
const ALLOWED_CODE_KEY = /^(error|failure|reason|status)/i;

// Values that look like PII even under an innocent key name.
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LONG_OPAQUE = /^[A-Za-z0-9._-]{24,}$/;

export const REDACTED = '[redacted]';

/**
 * Returns props safe to send: forbidden keys are dropped entirely, and
 * values that look like an email or an access token are replaced with a
 * marker so the event still arrives (and the leak is visible in dev)
 * without carrying the value.
 */
export function scrubProps(props?: AnalyticsProps): AnalyticsProps {
  if (!props) return {};
  const safe: AnalyticsProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (BLOCKED_KEY.test(key)) continue;
    if (CODE_KEY.test(key) && !ALLOWED_CODE_KEY.test(key)) continue;
    if (value === undefined) continue;
    if (typeof value === 'string' && (EMAIL_LIKE.test(value) || LONG_OPAQUE.test(value))) {
      safe[key] = REDACTED;
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  const safe = scrubProps(props);
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[track]', event, safe);
    return;
  }
  // Firebase Analytics, release builds only so development taps never land
  // in the real numbers. Never sees anything scrubProps removed.
  sendFirebaseEvent(event, safe);
}

/**
 * A screen view, by route shape — `/merchants/:id`, never the slug or id
 * itself (AKIBA-MOB-002 §14), so screens can be counted without recording
 * which voucher or visit a member opened.
 */
export function trackScreen(pathname: string): void {
  const screen = notificationRouteShape(pathname || '/');
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[screen]', screen);
    return;
  }
  sendFirebaseScreenView(screen);
}
