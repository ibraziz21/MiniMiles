// lib/pollRateLimit.ts
// In-process rate limiting for survey submission.
// Covers three independent axes:
//   - IP:   max failed submits per IP per window
//   - wallet: max reward-bearing completions per wallet per poll (hard stop)
//   - IP×wallet: fingerprint-level burst guard
//
// All state is process-local with lazy GC. This is appropriate for a single
// Next.js server process. If you run multiple replicas, move this to Redis.

// ── Config (overridable via env) ──────────────────────────────────────────────

const FAILED_SUBMIT_WINDOW_MS = Number(process.env.POLL_FAIL_WINDOW_MS ?? String(10 * 60 * 1000)); // 10 min
const MAX_FAILED_SUBMITS_PER_IP = Number(process.env.POLL_MAX_FAILS_PER_IP ?? "5");
const MAX_FAILED_SUBMITS_PER_WALLET = Number(process.env.POLL_MAX_FAILS_PER_WALLET ?? "5");

// Burst guard: max distinct wallets from the same IP submitting any poll
// within a rolling window before we start challenging them.
const IP_WALLET_WINDOW_MS = Number(process.env.POLL_IP_WALLET_WINDOW_MS ?? String(60 * 60 * 1000)); // 1 h
const MAX_WALLETS_PER_IP = Number(process.env.POLL_MAX_WALLETS_PER_IP ?? "10");

// ── State ─────────────────────────────────────────────────────────────────────

type Window = { count: number; resetAt: number };

// ip → failed submit count + window
const _ipFails = new Map<string, Window>();
// wallet → failed submit count + window
const _walletFails = new Map<string, Window>();
// ip → set of wallet addresses seen + window reset
const _ipWallets = new Map<string, { wallets: Set<string>; resetAt: number }>();

let _lastGc = Date.now();

function gc() {
  const now = Date.now();
  if (now - _lastGc < 60_000) return;
  _lastGc = now;
  for (const [k, v] of _ipFails) if (v.resetAt < now) _ipFails.delete(k);
  for (const [k, v] of _walletFails) if (v.resetAt < now) _walletFails.delete(k);
  for (const [k, v] of _ipWallets) if (v.resetAt < now) _ipWallets.delete(k);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function increment(map: Map<string, Window>, key: string, windowMs: number): number {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || entry.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  entry.count++;
  return entry.count;
}

// ── Public API ────────────────────────────────────────────────────────────────

export type RateLimitResult =
  | { ok: true }
  | { ok: false; reason: string; retryAfterMs?: number };

/**
 * Call before processing any poll submission attempt.
 * ip: extracted from request headers (cf-connecting-ip or x-forwarded-for).
 * walletAddress: lowercase wallet from session.
 */
export function checkPollSubmitRateLimit(ip: string, walletAddress: string): RateLimitResult {
  gc();
  const wallet = walletAddress.toLowerCase();

  // 1. IP-level failed submit guard
  const ipFails = _ipFails.get(ip);
  if (ipFails && ipFails.resetAt > Date.now() && ipFails.count >= MAX_FAILED_SUBMITS_PER_IP) {
    const retryAfterMs = ipFails.resetAt - Date.now();
    return {
      ok: false,
      reason: `Too many failed attempts from this network. Try again in ${Math.ceil(retryAfterMs / 60000)} min.`,
      retryAfterMs,
    };
  }

  // 2. Wallet-level failed submit guard
  const walletFails = _walletFails.get(wallet);
  if (walletFails && walletFails.resetAt > Date.now() && walletFails.count >= MAX_FAILED_SUBMITS_PER_WALLET) {
    const retryAfterMs = walletFails.resetAt - Date.now();
    return {
      ok: false,
      reason: `Too many failed attempts. Try again in ${Math.ceil(retryAfterMs / 60000)} min.`,
      retryAfterMs,
    };
  }

  // 3. IP → many wallets burst guard (potential bot-farm coordination)
  const ipWEntry = _ipWallets.get(ip);
  if (ipWEntry && ipWEntry.resetAt > Date.now()) {
    // Don't count — just check. We count on successful gate entry below.
    if (!ipWEntry.wallets.has(wallet) && ipWEntry.wallets.size >= MAX_WALLETS_PER_IP) {
      return {
        ok: false,
        reason: "Unusual activity detected. Please try again later.",
      };
    }
  }

  return { ok: true };
}

/**
 * Record a failed submission attempt for rate-limit tracking.
 */
export function recordFailedSubmit(ip: string, walletAddress: string): void {
  gc();
  const wallet = walletAddress.toLowerCase();
  increment(_ipFails, ip, FAILED_SUBMIT_WINDOW_MS);
  increment(_walletFails, wallet, FAILED_SUBMIT_WINDOW_MS);
}

/**
 * Record that a wallet successfully submitted from this IP.
 * Used to track wallet-per-IP diversity.
 */
export function recordSuccessfulSubmit(ip: string, walletAddress: string): void {
  gc();
  const wallet = walletAddress.toLowerCase();
  const now = Date.now();
  const entry = _ipWallets.get(ip);
  if (!entry || entry.resetAt < now) {
    _ipWallets.set(ip, { wallets: new Set([wallet]), resetAt: now + IP_WALLET_WINDOW_MS });
  } else {
    entry.wallets.add(wallet);
  }
}
