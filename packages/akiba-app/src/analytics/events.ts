/**
 * The AKIBA-MOB-001 §6 event vocabulary. A closed union rather than free
 * strings so a typo can't silently create a parallel event name that never
 * shows up in a funnel.
 */
export type AnalyticsEvent =
  | 'sign_in_started'
  | 'otp_sent'
  | 'otp_verified'
  // Password sign-in (AKIBA-MOB-001 §2 "Continue supporting password login
  // only if it is needed operationally"). Tracked separately from OTP so the
  // split is visible — OTP is meant to stay the primary path.
  | 'password_sign_in_submitted'
  | 'password_sign_in_succeeded'
  | 'password_sign_in_failed'
  | 'onboarding_started'
  | 'onboarding_step_viewed'
  | 'onboarding_completed'
  | 'onboarding_abandoned'
  | 'bootstrap_failed'
  | 'upgrade_required'
  // AKIBA-MOB-002 §14. Properties are limited to platform, app version,
  // flow step, a bounded error code, and already_requested — enforced by
  // scrubProps, not by each call site remembering.
  | 'account_deletion_opened'
  | 'account_deletion_challenge_requested'
  | 'account_deletion_verification_failed'
  | 'account_deletion_confirmed'
  | 'account_deletion_request_accepted'
  | 'account_deletion_request_failed'
  // Native push (migration plan Phase 5). Permission outcome and device
  // registration only — never a push token, which scrubProps would redact
  // as a long opaque value anyway.
  | 'push_permission_requested'
  | 'push_permission_granted'
  | 'push_permission_denied'
  | 'push_device_registered'
  | 'push_notification_opened';

/** Only non-PII scalars are carryable — see scrubProps in ./track. */
export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;
