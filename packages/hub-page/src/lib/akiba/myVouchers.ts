// Active-voucher summary for the member home's conditional vouchers strip
// (§2d). Same ownership resolution as GET /api/shop/vouchers/my (hub_user_id
// match, or legacy user_address match via linked wallets) — queried directly
// server-side here rather than round-tripping through that API route.
import { createAdminClient } from "@/lib/supabase/admin";

const EXPIRING_SOON_DAYS = 7;

/** All wallet addresses linked to this Hub user — matches the resolution
 *  GET /api/shop/vouchers/my uses (a user can have more than one). */
export async function getLinkedWalletAddresses(userId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", userId);
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
