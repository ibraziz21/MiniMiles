import { randomBytes } from "crypto";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { SessionData, sessionOptions } from "./session";

// ── Random per-request nonces ─────────────────────────────────────────────────
// Each call to generateNonce() produces a fresh random token stored in memory
// with a 10-min TTL. verifyNonce() finds and deletes it atomically — so the
// same nonce can never be used twice even if the signed payload is captured.
// This also means retries (component remount, page reload) always get a new
// nonce rather than the same deterministic one.

const NONCE_TTL_MS = 10 * 60 * 1000;

type NonceEntry = { nonce: string; expiresAt: number };
// address → pending nonce. One outstanding nonce per address at a time.
const _pendingNonces = new Map<string, NonceEntry>();

export function generateNonce(address: string): string {
  const nonce = randomBytes(16).toString("hex");
  const now = Date.now();
  _pendingNonces.set(address.toLowerCase(), { nonce, expiresAt: now + NONCE_TTL_MS });
  // Lazy GC
  if (Math.random() < 0.05) {
    for (const [k, v] of _pendingNonces) {
      if (v.expiresAt < now) _pendingNonces.delete(k);
    }
  }
  return nonce;
}

/**
 * Verifies and atomically consumes the nonce for an address.
 * Returns false if not found, expired, or already used.
 */
export function verifyNonce(address: string, nonce: string): boolean {
  const entry = _pendingNonces.get(address.toLowerCase());
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    _pendingNonces.delete(address.toLowerCase());
    return false;
  }
  if (entry.nonce !== nonce) return false;
  _pendingNonces.delete(address.toLowerCase()); // consume — one-time use
  return true;
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
