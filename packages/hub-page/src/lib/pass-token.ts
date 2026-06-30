/**
 * Server-only — Akiba Pass token signing and verification.
 *
 * Token format: {base64url(JSON_payload)}.{base64url(HMAC-SHA256_signature)}
 *
 * The token is opaque to the client. Only Hub can issue or verify it.
 * The QR encodes the raw token string; the merchant dashboard calls
 * GET /api/me/pass/resolve?token=<token> to resolve it to a safe identity.
 *
 * Required env var:
 *   HUB_PASS_SECRET  — 32+ char random string, never exposed to clients.
 *   Falls back to SUPABASE_SERVICE_KEY for zero-config local dev.
 */

import { createHmac, timingSafeEqual } from "crypto";

const EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

function secret(): string {
  const s = process.env.HUB_PASS_SECRET ?? process.env.SUPABASE_SERVICE_KEY ?? "";
  if (!s) {
    console.warn("[pass-token] HUB_PASS_SECRET is not set — tokens will not verify correctly");
  }
  return s;
}

type PassPayload = {
  sub: string;   // Supabase user UUID
  email: string;
  iat: number;   // issued-at unix seconds
  exp: number;   // expires-at unix seconds
};

function hmacB64url(encodedPayload: string): string {
  return createHmac("sha256", secret())
    .update(encodedPayload)
    .digest("base64url");
}

export function signPassToken(userId: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: PassPayload = { sub: userId, email, iat: now, exp: now + EXPIRY_SECONDS };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = hmacB64url(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export type VerifiedPass = {
  userId: string;
  email: string;
  /** Remaining seconds until expiry */
  expiresInSeconds: number;
};

export function verifyPassToken(token: string): VerifiedPass | null {
  if (!secret()) return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;

  const encodedPayload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  // Constant-time signature comparison
  const expected = Buffer.from(hmacB64url(encodedPayload), "base64url");
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let payload: PassPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as PassPayload;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;
  if (!payload.sub || !payload.email) return null;

  return {
    userId: payload.sub,
    email: payload.email,
    expiresInSeconds: payload.exp - now,
  };
}
