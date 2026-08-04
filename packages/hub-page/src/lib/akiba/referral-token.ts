/**
 * Server-only — referral attribution cookie signing/verification
 * (referral-system-spec.md §3.2, §15).
 *
 * The cookie is a signed, opaque token: {base64url(raw 32 random bytes)}.
 * {base64url(HMAC-SHA256 signature)}. The raw token is never itself
 * meaningful — only its SHA-256 hash is stored in referral_clicks
 * (§5.3 "the database stores only its hash"), so binding a referral is a
 * DB lookup by hash, not by decoding cookie contents. Signing still
 * matters per §15 ("Sign cookies with a purpose-specific secret") so a
 * tampered cookie value is rejected before it ever reaches a DB lookup.
 *
 * Required env var: HUB_REFERRAL_SECRET — 32+ char random string, its own
 * credential (not shared with HUB_PASS_SECRET or SUPABASE_SERVICE_KEY),
 * same reasoning as pass-token.ts.
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from "crypto";
import { getServerEnv } from "@/lib/env.server";

export const REFERRAL_COOKIE_NAME = "akiba_ref";
export const REFERRAL_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days (§15 cap)

function secret(): string {
  const s = getServerEnv().hubReferralSecret ?? "";
  if (!s) {
    console.warn("[referral-token] HUB_REFERRAL_SECRET is not set — referral cookies will not verify correctly");
  }
  return s;
}

function hmacB64url(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export type SignedReferralToken = {
  /** Value to store in the cookie. */
  cookieValue: string;
  /** SHA-256 hex hash of the raw token — what accept_referral_click stores/looks up. */
  tokenHash: string;
};

/** Generates a fresh random attribution token and its signed cookie form. */
export function createReferralToken(): SignedReferralToken {
  const raw = randomBytes(32).toString("base64url");
  const signature = hmacB64url(raw);
  return {
    cookieValue: `${raw}.${signature}`,
    tokenHash: createHash("sha256").update(raw).digest("hex"),
  };
}

/**
 * Verifies a cookie value read back from the browser and returns the same
 * token_hash that was stored at click-accept time, or null if the cookie
 * is missing, malformed, or fails signature verification.
 */
export function verifyReferralCookie(cookieValue: string | undefined | null): string | null {
  if (!cookieValue || !secret()) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot === -1) return null;

  const raw = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);

  const expected = Buffer.from(hmacB64url(raw), "base64url");
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  return createHash("sha256").update(raw).digest("hex");
}
