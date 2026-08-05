// Verifies short-lived signed service assertions from the Pass (hub-page) BFF.
// walletless-pass-skill-games-spec.md §7.2. Hand-rolled HMAC, matching the
// only sign/verify convention already in this monorepo
// (packages/hub-page/src/lib/pass-token.ts) rather than adding a JWT
// dependency: base64url(JSON claims) + "." + base64url(HMAC-SHA256 signature).
//
// A generic shared secret is not enough (spec explicitly rules that out) —
// every claim below is checked, not just the signature.

import { createHmac, timingSafeEqual } from "crypto";
import { supabase } from "../supabaseClient";

const ISSUER = "hub-page";
const AUDIENCE = "skill-games-backend";
const MAX_CLOCK_SKEW_SECONDS = 5;

export type ServiceAssertionClaims = {
  iss: string;
  aud: string;
  sub: string; // canonical_id
  hubUserId: string;
  method: string;
  path: string;
  iat: number;
  exp: number;
  jti: string;
};

export type VerifiedAssertion = {
  canonicalId: string;
  hubUserId: string;
};

function secret(): string {
  const value = process.env.GAMES_SERVICE_ASSERTION_SECRET ?? "";
  if (!value) throw new Error("GAMES_SERVICE_ASSERTION_SECRET is not configured");
  return value;
}

function hmacB64url(encodedPayload: string): string {
  return createHmac("sha256", secret()).update(encodedPayload).digest("base64url");
}

export type AssertionRejection =
  | "missing"
  | "malformed"
  | "bad-signature"
  | "expired"
  | "not-yet-valid"
  | "wrong-issuer"
  | "wrong-audience"
  | "wrong-scope"
  | "replayed"
  | "config-error";

export type AssertionVerifyResult =
  | { ok: true; assertion: VerifiedAssertion }
  | { ok: false; reason: AssertionRejection };

/**
 * Verifies a raw `Authorization: Bearer <assertion>` value against the
 * method/path the caller actually hit. Every rejection reason is reported so
 * callers can produce structured audit records (spec §15/§16) — never a bare
 * boolean.
 */
export async function verifyServiceAssertion(
  token: string | undefined,
  expected: { method: string; path: string }
): Promise<AssertionVerifyResult> {
  if (!token) return { ok: false, reason: "missing" };

  const dot = token.lastIndexOf(".");
  if (dot === -1) return { ok: false, reason: "malformed" };

  const encodedPayload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let expectedSig: Buffer;
  try {
    expectedSig = Buffer.from(hmacB64url(encodedPayload), "base64url");
  } catch {
    return { ok: false, reason: "config-error" };
  }
  const actualSig = Buffer.from(signature, "base64url");
  if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
    return { ok: false, reason: "bad-signature" };
  }

  let claims: ServiceAssertionClaims;
  try {
    claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof claims.sub !== "string" || !claims.sub ||
    typeof claims.hubUserId !== "string" || !claims.hubUserId ||
    typeof claims.iat !== "number" || typeof claims.exp !== "number" ||
    typeof claims.jti !== "string" || !claims.jti
  ) {
    return { ok: false, reason: "malformed" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.iat > now + MAX_CLOCK_SKEW_SECONDS) return { ok: false, reason: "not-yet-valid" };
  if (claims.exp < now) return { ok: false, reason: "expired" };
  if (claims.iss !== ISSUER) return { ok: false, reason: "wrong-issuer" };
  if (claims.aud !== AUDIENCE) return { ok: false, reason: "wrong-audience" };
  if (claims.method !== expected.method || claims.path !== expected.path) {
    return { ok: false, reason: "wrong-scope" };
  }

  const { data: claimed, error } = await supabase.rpc("claim_skill_game_service_assertion_jti", {
    p_jti: claims.jti,
    p_expires_at: new Date(claims.exp * 1000).toISOString(),
  });
  if (error) {
    console.error("[serviceAssertion] jti claim failed:", error.message);
    return { ok: false, reason: "config-error" };
  }
  if (claimed !== true) return { ok: false, reason: "replayed" };

  return { ok: true, assertion: { canonicalId: claims.sub, hubUserId: claims.hubUserId } };
}
