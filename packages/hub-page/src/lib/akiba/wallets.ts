// Linked-wallet listing for display (verification state, ecosystem) —
// extracted from src/app/api/me/wallets/route.ts so that route and
// GET /api/v1/me/settings call the same loader instead of each inlining
// the query. Distinct from getLinkedWalletAddresses (myVouchers.ts), which
// returns only verified address strings for ownership matching, not a
// display-ready per-wallet list.
import { createAdminClient } from "@/lib/supabase/admin";

export type LinkedWallet = {
  ecosystem: string;
  address: string;
  isPrimary: boolean;
  linkedAt: string;
  verificationStatus: string;
};

export async function listLinkedWallets(userId: string): Promise<LinkedWallet[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hub_user_wallets")
    .select("ecosystem, address, is_primary, linked_at, verification_status")
    .eq("user_id", userId)
    .order("linked_at");

  if (error) throw error;

  return ((data ?? []) as Array<{
    ecosystem: string;
    address: string;
    is_primary: boolean;
    linked_at: string;
    verification_status: string;
  }>).map((row) => ({
    ecosystem: row.ecosystem,
    address: row.address,
    isPrimary: row.is_primary,
    linkedAt: row.linked_at,
    verificationStatus: row.verification_status,
  }));
}
