/**
 * Shared bearer-key check for inbound internal/Platform-to-Hub calls
 * (e.g. /api/internal/miles-credited, /api/internal/verified-earning-
 * status) — the same Hub<->Platform shared secret, rotatable via
 * AKIBA_API_KEYS (comma-separated) with AKIBA_API_KEY as the single-key
 * fallback. Extracted once two call sites needed byte-for-byte identical
 * timing-safe comparison logic.
 */
import { timingSafeEqual } from "crypto";

function validKeys(): string[] {
  const multi = (process.env.AKIBA_API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const single = (process.env.AKIBA_API_KEY ?? "").trim();
  return multi.length > 0 ? multi : single ? [single] : [];
}

export function isValidInternalApiKey(candidate: string): boolean {
  const cand = Buffer.from(candidate);
  let ok = false;
  for (const key of validKeys()) {
    const buf = Buffer.from(key);
    if (buf.length === cand.length && timingSafeEqual(buf, cand)) ok = true;
  }
  return ok;
}
