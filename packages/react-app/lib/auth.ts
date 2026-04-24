import { randomBytes } from "crypto";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { SessionData, sessionOptions } from "./session";
import { supabase } from "./supabaseClient";

// ── DB-backed sign-in nonces ──────────────────────────────────────────────────
// Nonces are stored in the `auth_nonces` table (see sql/auth_nonces.sql).
// One outstanding nonce per address — issuing a new one overwrites the old one
// via upsert. verifyNonce DELETEs the row so the same nonce can never be reused.
// This survives multi-instance deployments (Vercel, etc.) unlike an in-memory Map.

const NONCE_TTL_SEC = 10 * 60; // 10 minutes

export async function generateNonce(address: string): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + NONCE_TTL_SEC * 1000).toISOString();

  await supabase
    .from("auth_nonces")
    .upsert(
      { address: address.toLowerCase(), nonce, expires_at: expiresAt },
      { onConflict: "address" },
    );

  return nonce;
}

/**
 * Verifies and atomically consumes the nonce for an address.
 * Returns false if not found, expired, or already used.
 */
export async function verifyNonce(address: string, nonce: string): Promise<boolean> {
  const addr = address.toLowerCase();

  // Delete the row only if address + nonce + not-expired all match.
  // count = 0 means no match → reject. count = 1 means consumed → accept.
  const { count, error } = await supabase
    .from("auth_nonces")
    .delete({ count: "exact" })
    .eq("address", addr)
    .eq("nonce", nonce)
    .gt("expires_at", new Date().toISOString());

  if (error) {
    console.error("[auth] nonce verification DB error", error);
    return false;
  }

  return (count ?? 0) > 0;
}

export function buildSignInMessage(address: string, nonce: string): string {
  return [
    "Sign in to MiniMiles",
    "",
    "This request does not trigger a blockchain transaction or cost any fees.",
    "",
    `Address: ${address.toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}

// ── Session helpers ───────────────────────────────────────────────────────────

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/**
 * Returns the verified wallet address from the session,
 * or null if the request is unauthenticated.
 * Use this in every reward-affecting route.
 */
export async function requireSession(): Promise<{ walletAddress: string; issuedAt: number } | null> {
  const session = await getSession();
  if (!session.walletAddress) return null;
  return { walletAddress: session.walletAddress, issuedAt: session.issuedAt ?? 0 };
}

// ── Session age gate ──────────────────────────────────────────────────────────
// Minimum ms between sign-in and first claim. Default: 60 s.
// Set SESSION_MIN_AGE_MS env var to override.
export const SESSION_MIN_AGE_MS = Number(process.env.SESSION_MIN_AGE_MS ?? "60000");

/**
 * Logs how old the current session is relative to the minimum required age.
 * Call this after requireSession() in every claim route.
 * Returns true if the session is old enough, false if it would be blocked.
 * No requests are blocked yet — this is observation-only.
 */
export function logSessionAge(route: string, walletAddress: string, issuedAt: number): boolean {
  const ageMs = Date.now() - (issuedAt ?? 0);
  const ageS = Math.round(ageMs / 1000);
  const minS = Math.round(SESSION_MIN_AGE_MS / 1000);
  const wouldBlock = ageMs < SESSION_MIN_AGE_MS;
  console.log(
    `[session-age] route=${route} addr=${walletAddress.slice(0, 8)}… age=${ageS}s min=${minS}s WOULD_BLOCK=${wouldBlock}`
  );
  return !wouldBlock;
}
