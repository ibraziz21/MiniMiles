// lib/loginRateLimit.ts
// DB-backed login rate limiting for merchant auth.
// Tracks failed attempts per email. After MAX_FAILURES within the window the
// account is locked for LOCKOUT_MINUTES and every attempt is rejected until the
// window expires — no password check is performed while locked.

import { supabase } from "./supabase";

const MAX_FAILURES = 5;
const LOCKOUT_MINUTES = 15;

/**
 * Call BEFORE verifying the password.
 * Returns { allowed: false, retryAfter: Date } when the account is locked.
 * Returns { allowed: true } when the attempt may proceed.
 */
export async function checkLoginRateLimit(
  email: string,
): Promise<{ allowed: true } | { allowed: false; retryAfter: Date }> {
  const key = email.toLowerCase().trim();
  const now = new Date();
  const windowStart = new Date(now.getTime() - LOCKOUT_MINUTES * 60 * 1000).toISOString();

  const { data: row } = await supabase
    .from("auth_login_attempts")
    .select("failures, locked_until")
    .eq("email", key)
    .maybeSingle();

  if (row?.locked_until && new Date(row.locked_until) > now) {
    return { allowed: false, retryAfter: new Date(row.locked_until) };
  }

  // Count failures in the current window
  if (row && row.failures >= MAX_FAILURES) {
    // Window has expired (locked_until is null or past) but failures counter
    // hasn't been reset yet — reset it now and allow.
    await supabase
      .from("auth_login_attempts")
      .update({ failures: 0, locked_until: null, updated_at: now.toISOString() })
      .eq("email", key);
  }

  return { allowed: true };
}

/**
 * Call AFTER a failed password verification.
 * Increments the failure counter and sets locked_until when MAX_FAILURES is reached.
 */
export async function recordLoginFailure(email: string): Promise<void> {
  const key = email.toLowerCase().trim();
  const now = new Date();

  const { data: row } = await supabase
    .from("auth_login_attempts")
    .select("failures")
    .eq("email", key)
    .maybeSingle();

  const newFailures = (row?.failures ?? 0) + 1;
  const lockedUntil =
    newFailures >= MAX_FAILURES
      ? new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
      : null;

  await supabase
    .from("auth_login_attempts")
    .upsert(
      {
        email: key,
        failures: newFailures,
        locked_until: lockedUntil,
        updated_at: now.toISOString(),
      },
      { onConflict: "email" },
    );
}

/**
 * Call AFTER a successful login.
 * Resets the failure counter so a legitimate user isn't locked out after
 * eventually entering the correct password.
 */
export async function recordLoginSuccess(email: string): Promise<void> {
  const key = email.toLowerCase().trim();
  await supabase
    .from("auth_login_attempts")
    .upsert(
      { email: key, failures: 0, locked_until: null, updated_at: new Date().toISOString() },
      { onConflict: "email" },
    );
}
