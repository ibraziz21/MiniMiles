// Referral domain helpers shared by the /r/[code] route and the
// /api/referrals/* routes (referral-system-spec.md).
import { createHmac } from "crypto";
import { getServerEnv } from "@/lib/env.server";

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/; // Crockford Base32 alphabet (excludes I, L, O, U)

/** Upper-cases and trims user/URL-supplied input before any code lookup (§5.2 case-insensitive lookup). */
export function normalizeReferralCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isPlausibleReferralCode(code: string): boolean {
  return CODE_RE.test(code);
}

export function buildReferralUrl(code: string): string {
  const siteUrl = getServerEnv().siteUrl.replace(/\/+$/, "");
  return `${siteUrl}/r/${code}`;
}

/**
 * Purpose-specific HMAC over a raw click signal (IP address, device
 * fingerprint) before it's ever written to referral_clicks (§5.3, §10.4 —
 * "Never store raw IP addresses in referral tables"). Uses the same
 * HUB_REFERRAL_SECRET as the attribution cookie with a distinct domain
 * label, not a separate credential — this is HMAC domain separation
 * within one system, not credential reuse across systems.
 */
export function hashClickSignal(value: string, domain: "ip" | "device"): string {
  const secret = getServerEnv().hubReferralSecret ?? "";
  return createHmac("sha256", secret).update(`${domain}:${value}`).digest("hex");
}

/**
 * Privacy-safe label for the referred friend on the referrer's dashboard
 * (§3.3, §9.2). V1 has no "chosen first name" field for referred members —
 * that's a stated future extension (§3.3 "shown only if the referrer
 * explicitly allows it in a future preference") — so every friend is
 * labelled generically for now rather than exposing email/phone/wallet.
 */
export function friendLabel(): string {
  return "A friend";
}
