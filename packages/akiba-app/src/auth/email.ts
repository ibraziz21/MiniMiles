/**
 * Client-side email checks for the OTP flow (AKIBA-MOB-001 §2 "Email
 * validation before submission").
 *
 * Intentionally permissive: the only job here is to catch the typo cases —
 * no "@", no domain dot, stray whitespace — before spending a round trip
 * and one of Supabase's rate-limited sends. Authoritative validation stays
 * server-side.
 */
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const normalized = normalizeEmail(value);
  return normalized.length <= 254 && SHAPE.test(normalized);
}

/** The message shown under the email field, or null when it's fine. */
export function emailFieldError(value: string): string | null {
  if (!value.trim()) return 'Enter your email address.';
  if (!isValidEmail(value)) return 'Enter a valid email address, like you@example.com.';
  return null;
}
