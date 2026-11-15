/**
 * Changing the sign-in password from Settings → Security.
 *
 * A signed-in phone is not proof of who is holding it, so a new password is
 * only accepted with a fresh code emailed to the account: reauthenticate()
 * sends it, and updateUser() takes it as the `nonce`. Supabase enforces the
 * code server-side when "Secure password change" is on for the project;
 * the app always asks for it either way.
 *
 * Copy follows ./errors.ts: nothing from the server reaches the screen.
 */
import { supabase } from './supabase';

export const MIN_PASSWORD_LENGTH = 8;
// bcrypt, which Supabase Auth uses, ignores everything past 72 bytes.
export const MAX_PASSWORD_LENGTH = 72;

type SupabaseLikeError = { code?: string; status?: number; message?: string };

const OFFLINE = 'We couldn’t reach Akiba. Check your connection and try again.';

/** Why this password can't be used yet, or null when it can. */
export function passwordProblem(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_LENGTH) return 'Use a shorter password.';
  if (password.trim().length === 0) return 'Use some letters or numbers, not only spaces.';
  if (confirmation !== password) return 'The two passwords don’t match.';
  return null;
}

export function passwordChangeErrorMessage(error: unknown): string {
  const { code, status, message } = (error ?? {}) as SupabaseLikeError;
  switch (code) {
    case 'reauthentication_not_valid':
    case 'otp_expired':
      return 'That code didn’t work or has expired. Request a new one.';
    case 'reauthentication_needed':
    case 'reauth_nonce_missing':
      return 'Enter the code we emailed you to confirm it’s you.';
    case 'same_password':
      return 'That’s already your password. Choose a different one.';
    case 'weak_password':
      return 'Choose a stronger password — mix letters, numbers and symbols.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a minute, then try again.';
    case 'session_not_found':
    case 'session_expired':
      return 'Your session has ended. Sign in again, then change your password.';
  }
  if (status === 429) return 'Too many attempts. Wait a minute, then try again.';
  if (!status && /network|fetch/i.test(message ?? '')) return OFFLINE;
  return 'Couldn’t change your password. Please try again.';
}

/** Emails a one-time code to the signed-in account. */
export async function requestPasswordChangeCode(): Promise<void> {
  const { error } = await supabase.auth.reauthenticate();
  if (error) throw error;
}

export async function changePassword(password: string, code: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password, nonce: code.trim() });
  if (error) throw error;
}
