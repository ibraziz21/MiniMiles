// lib/server/dailyVoucherRateLimit.ts
//
// In-process rate limiting for POST /api/quests/daily/voucher
// (docs/daily-checkin-self-claim-spec.md §4). Deliberately generous per the
// spec requirement that a legitimate same-day retry after wallet rejection
// must never be blocked — this only guards against bursts/automation, not
// normal human retry cadence. Process-local like lib/pollRateLimit.ts; move
// to Redis if this ever runs multi-replica.

const WINDOW_MS = Number(process.env.DAILY_VOUCHER_RATE_LIMIT_WINDOW_MS ?? String(60 * 1000));
const MAX_PER_WALLET = Number(process.env.DAILY_VOUCHER_RATE_LIMIT_PER_WALLET ?? "12");
const MAX_PER_IP = Number(process.env.DAILY_VOUCHER_RATE_LIMIT_PER_IP ?? "30");

type Window = { count: number; resetAt: number };

const _walletHits = new Map<string, Window>();
const _ipHits = new Map<string, Window>();

let _lastGc = Date.now();

function gc() {
  const now = Date.now();
  if (now - _lastGc < 60_000) return;
  _lastGc = now;
  for (const [k, v] of _walletHits) if (v.resetAt < now) _walletHits.delete(k);
  for (const [k, v] of _ipHits) if (v.resetAt < now) _ipHits.delete(k);
}

function bump(map: Map<string, Window>, key: string): number {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || entry.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return 1;
  }
  entry.count++;
  return entry.count;
}

export type DailyVoucherRateLimitResult =
  | { ok: true }
  | { ok: false; reason: string };

export function checkDailyVoucherRateLimit(ip: string, walletAddress: string): DailyVoucherRateLimitResult {
  gc();
  const wallet = walletAddress.toLowerCase();
  const now = Date.now();

  const walletWindow = _walletHits.get(wallet);
  if (walletWindow && walletWindow.resetAt > now && walletWindow.count >= MAX_PER_WALLET) {
    return { ok: false, reason: "Too many claim attempts. Please wait a moment and try again." };
  }

  const ipWindow = _ipHits.get(ip);
  if (ipWindow && ipWindow.resetAt > now && ipWindow.count >= MAX_PER_IP) {
    return { ok: false, reason: "Too many claim attempts from this network. Please wait a moment and try again." };
  }

  bump(_walletHits, wallet);
  bump(_ipHits, ip);
  return { ok: true };
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}
