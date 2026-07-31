/**
 * Durable rate limiting (production-readiness-security-spec.md §3.5, §9.2).
 * Backed by the shared `check_rate_limit` Postgres function
 * (supabase/migrations/050_shared_rate_limit_primitive.sql) — a fixed-bucket
 * counter shared across all server instances, unlike an in-memory map.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export type RateLimitCheck = {
  /** Stable key for this caller/action, e.g. `wallet_challenge:user:<uuid>`. */
  scope: string;
  limit: number;
  windowSeconds: number;
};

/** Returns true if the call is within the limit (and increments the counter); false if it should be rejected. */
export async function checkRateLimit({ scope, limit, windowSeconds }: RateLimitCheck): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_scope: scope,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    // Fail closed on infrastructure error for security-sensitive limiters —
    // a limiter that can't be checked must not silently allow the call.
    console.error(`[rateLimit] check_rate_limit failed for scope "${scope}":`, error.message);
    return false;
  }

  return data === true;
}

/** Runs several independent rate-limit checks and returns true only if all pass. */
export async function checkAllRateLimits(checks: RateLimitCheck[]): Promise<boolean> {
  const results = await Promise.all(checks.map(checkRateLimit));
  return results.every(Boolean);
}
