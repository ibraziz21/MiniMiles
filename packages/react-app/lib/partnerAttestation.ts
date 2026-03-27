/**
 * partnerAttestation.ts
 *
 * Issues and verifies short-lived HMAC claim tokens for partner quests.
 *
 * Flow:
 *   1. GET /api/partner-quests/eligibility?questId=X
 *      → server checks eligibility, returns { attestationToken }
 *   2. POST /api/partner-quests/claim { questId, attestationToken }
 *      → server verifies token before minting
 *
 * This ensures every successful claim went through the eligibility gate,
 * preventing direct-to-claim POST farming.
 */

import { createHmac } from "crypto";

// Each token is valid for 5 minutes
const TOKEN_WINDOW_MS = 5 * 60 * 1000;

function secret(): string {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET not set");
  return process.env.SESSION_SECRET;
}

function windowFor(ts: number): number {
  return Math.floor(ts / TOKEN_WINDOW_MS);
}

/**
 * Issue a claim token for (address, questId).
 * Valid for up to 10 minutes (current + previous window in verify).
 */
export function issueClaimToken(address: string, questId: string): string {
  const window = windowFor(Date.now());
  return createHmac("sha256", secret())
    .update(`partner:${address.toLowerCase()}:${questId}:${window}`)
    .digest("hex")
    .slice(0, 40);
}

/**
 * Returns true if the token is valid for (address, questId).
 * Checks current and previous window to allow for clock skew.
 */
export function verifyClaimToken(
  address: string,
  questId: string,
  token: string
): boolean {
  if (!token || token.length !== 40) return false;
  const current = windowFor(Date.now());
  for (const w of [current, current - 1]) {
    const expected = createHmac("sha256", secret())
      .update(`partner:${address.toLowerCase()}:${questId}:${w}`)
      .digest("hex")
      .slice(0, 40);
    if (expected === token) return true;
  }
  return false;
}

// One-time use guard — same TTL as the token window
const _consumedTokens = new Map<string, number>();

/**
 * Consume a token so it cannot be reused.
 * Returns false if the token was already consumed.
 */
export function consumeClaimToken(
  address: string,
  questId: string,
  token: string
): boolean {
  const key = `${address.toLowerCase()}:${questId}:${token}`;
  const now = Date.now();
  if (_consumedTokens.has(key)) return false;
  _consumedTokens.set(key, now + TOKEN_WINDOW_MS * 2);
  if (Math.random() < 0.1) {
    for (const [k, exp] of _consumedTokens) {
      if (exp < now) _consumedTokens.delete(k);
    }
  }
  return true;
}
