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

export type AuthErrorContext = 'send' | 'verify';

const OFFLINE = 'We couldn’t reach Akiba. Check your connection and try again.';
const RATE_LIMITED = 'Too many attempts. Wait a minute, then request a new code.';
const BAD_EMAIL = 'That email address doesn’t look right. Check it and try again.';
const BAD_CODE = 'That code didn’t work. Check the 6 digits, or request a new one.';
const EXPIRED_CODE = 'That code has expired. Request a new one to continue.';
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
    return `Please wait ${cooldown} second${cooldown === 1 ? '' : 's'} before requesting another code.`;
  }

  switch (code) {
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
    case 'over_sms_send_rate_limit':
      return RATE_LIMITED;
    case 'email_address_invalid':
    case 'email_address_not_authorized':
    case 'validation_failed':
      return context === 'send' ? BAD_EMAIL : BAD_CODE;
    case 'otp_expired':
      return EXPIRED_CODE;
    case 'otp_disabled':
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'Email sign-in is temporarily unavailable. Please try again later.';
    case 'invalid_credentials':
      return BAD_CODE;
    case 'user_banned':
      return 'This account can’t sign in right now. Contact support@akibamiles.com for help.';
    default:
      break;
  }

  if (status === 429) return RATE_LIMITED;
  if (status === 422 && context === 'send') return BAD_EMAIL;
  if ((status === 400 || status === 401 || status === 403) && context === 'verify') return BAD_CODE;
  if (typeof status === 'number' && status >= 500) return 'Akiba is having trouble right now. Please try again shortly.';

  return GENERIC;
}
