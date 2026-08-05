// Signs short-lived Pass-to-Backend service assertions.
// walletless-pass-skill-games-spec.md §7.2. Same hand-rolled HMAC shape as
// packages/backend/src/games/serviceAssertion.ts verifies, and the same
// construction as this package's own pass-token.ts: base64url(JSON claims)
// + "." + base64url(HMAC-SHA256 signature). Never imported by client code —
// the secret must never reach the browser.

import { createHmac, randomUUID } from "crypto";
import { getServerEnv } from "@/lib/env.server";

const ISSUER = "hub-page";
const AUDIENCE = "skill-games-backend";
const EXPIRY_SECONDS = 60;

function secret(): string {
  const value = getServerEnv().gamesBackend.assertionSecret;
  if (!value) throw new Error("GAMES_SERVICE_ASSERTION_SECRET is not configured");
  return value;
}

function hmacB64url(encodedPayload: string): string {
  return createHmac("sha256", secret()).update(encodedPayload).digest("base64url");
}

/**
 * Signs one assertion bound to exactly the method+path being called. A fresh
 * assertion must be signed per outbound request — it is not reusable across
 * calls, and expires within 60 seconds regardless.
 */
export function signServiceAssertion(input: {
  canonicalId: string;
  hubUserId: string;
  method: string;
  path: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: input.canonicalId,
    hubUserId: input.hubUserId,
    method: input.method,
    path: input.path,
    iat: now,
    exp: now + EXPIRY_SECONDS,
    jti: randomUUID(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = hmacB64url(encodedPayload);
  return `${encodedPayload}.${signature}`;
}
