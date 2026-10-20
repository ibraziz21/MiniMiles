/**
 * Supabase auth errors, translated for members (AKIBA-MOB-001 §2 "Friendly
 * mapped errors instead of raw Supabase messages").
 *
 * Nothing from the server reaches the screen: every branch returns one of
 * the strings below, and the default is a generic message. Matching is by
 * `code` first (stable across Supabase releases), then HTTP status, then —
 * only for the one message Supabase carries real information in, its
 * "try again in N seconds" cooldown — the message text.
 */

type SupabaseLikeError = {
  name?: string;
  code?: string;
  status?: number;
  message?: string;
};

export type AuthErrorContext = 'send' | 'verify' | 'password';

const OFFLINE = 'We couldn’t reach Akiba. Check your connection and try again.';
const RATE_LIMITED = 'Too many attempts. Wait a minute, then request a new code.';
const BAD_EMAIL = 'That email address doesn’t look right. Check it and try again.';
const BAD_CODE = 'That code didn’t work. Check the 6 digits, or request a new one.';
const EXPIRED_CODE = 'That code has expired. Request a new one to continue.';
// Covers two cases Supabase reports identically: a wrong password, and an
// account that has never set one (OTP-only members, which is most of them).
// Naming the code route keeps the second case from being a dead end.
const BAD_PASSWORD = 'That email and password didn’t match. You can sign in with a code instead.';
const UNCONFIRMED = 'Confirm your email address first. Sign in with a code to finish setting up.';
const GENERIC = 'Something went wrong. Please try again.';

function asSupabaseError(error: unknown): SupabaseLikeError {
  return error && typeof error === 'object' ? (error as SupabaseLikeError) : {};
}

/** Seconds Supabase says to wait, when it says so; null otherwise. */
export function parseCooldownSeconds(error: unknown): number | null {
  const { message } = asSupabaseError(error);
  const match = message ? /after (\d+) seconds?/i.exec(message) : null;
  return match ? Number.parseInt(match[1], 10) : null;
}

export function mapAuthError(error: unknown, context: AuthErrorContext): string {
  const { name, code, status, message } = asSupabaseError(error);

  // Transport failure — Supabase surfaces these as AuthRetryableFetchError
  // with status 0, and they are the single most common real-world case on a
  // mobile network.
  if (name === 'AuthRetryableFetchError' || status === 0) return OFFLINE;
  if (typeof message === 'string' && /network request failed|fetch failed/i.test(message)) return OFFLINE;

  const cooldown = parseCooldownSeconds(error);
  if (cooldown !== null) {
    const seconds = `${cooldown} second${cooldown === 1 ? '' : 's'}`;
    // A password attempt is not requesting anything, so the OTP wording
    // would be nonsense there.
    return context === 'password'
      ? `Please wait ${seconds} before trying again.`
      : `Please wait ${seconds} before requesting another code.`;
  }

  switch (code) {
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
    case 'over_sms_send_rate_limit':
      return RATE_LIMITED;
    case 'email_address_invalid':
    case 'email_address_not_authorized':
    case 'validation_failed':
      // Only the verify step is about the code; send and password are both
      // judging the email the member typed.
      return context === 'verify' ? BAD_CODE : BAD_EMAIL;
    case 'otp_expired':
      return EXPIRED_CODE;
    case 'otp_disabled':
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'Email sign-in is temporarily unavailable. Please try again later.';
    case 'invalid_credentials':
      return context === 'password' ? BAD_PASSWORD : BAD_CODE;
    case 'email_not_confirmed':
      return UNCONFIRMED;
    case 'user_banned':
      return 'This account can’t sign in right now. Contact support@akibamiles.com for help.';
    default:
      break;
  }

  if (status === 429) return RATE_LIMITED;
  if (status === 422 && context !== 'verify') return BAD_EMAIL;
  if (status === 400 || status === 401 || status === 403) {
    if (context === 'verify') return BAD_CODE;
    if (context === 'password') return BAD_PASSWORD;
  }
  if (typeof status === 'number' && status >= 500) return 'Akiba is having trouble right now. Please try again shortly.';

  return GENERIC;
}
