// Active-voucher summary for the member home's conditional vouchers strip
// (§2d). Same ownership resolution as GET /api/shop/vouchers/my (hub_user_id
// match, or legacy user_address match via linked wallets) — queried directly
// server-side here rather than round-tripping through that API route.
import { createAdminClient } from "@/lib/supabase/admin";

const EXPIRING_SOON_DAYS = 7;

export function isMissingWalletVerificationColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "42703"
    && typeof candidate.message === "string"
    && candidate.message.includes("hub_user_wallets.verification_status");
}

/** Verified wallet addresses linked to this Hub user — matches the resolution
 *  GET /api/shop/vouchers/my uses (a user can have more than one). Only
 *  `verified` wallets authorize asset/reward lookups
 *  (production-readiness-security-spec.md §3.4/§3.6) — a `legacy_unverified`
 *  row is visible in the wallet UI but cannot be used here. */
export async function getLinkedWalletAddresses(userId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", userId)
    .eq("verification_status", "verified");
  if (error) {
    // Databases that have not applied 051_verified_wallet_linking.sql have no
    // trustworthy way to distinguish an owned wallet from a legacy address.
    // Treat those users as walletless until the migration is applied instead
    // of either crashing the page or granting wallet authority incorrectly.
    if (isMissingWalletVerificationColumn(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => r.address.toLowerCase());
}

export type VoucherStripSummary = {
  activeCount: number;
  expiringSoonCount: number;
};

export async function getActiveVoucherSummary(opts: {
  userId: string;
  walletAddresses: string[];
}): Promise<VoucherStripSummary> {
  const { userId, walletAddresses } = opts;
  const admin = createAdminClient();

  let query = admin
    .from("issued_vouchers")
    .select("id, status, expires_at")
    .eq("status", "issued");

  query = walletAddresses.length > 0
    ? query.or(`hub_user_id.eq.${userId},user_address.in.(${walletAddresses.join(",")})`)
    : query.eq("hub_user_id", userId);

  const { data, error } = await query;
  if (error) {
    console.error("[myVouchers] query error →", error.message);
    return { activeCount: 0, expiringSoonCount: 0 };
  }

  const rows = data ?? [];
  const soonCutoff = Date.now() + EXPIRING_SOON_DAYS * 86_400_000;
  const expiringSoonCount = rows.filter(
    (v) => v.expires_at && new Date(v.expires_at).getTime() <= soonCutoff,
  ).length;

  return { activeCount: rows.length, expiringSoonCount };
}
