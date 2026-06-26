import { createAdminClient } from "@/lib/supabase/admin";

/**
 * After login, look up the `users` table by email and auto-import any
 * matching wallet addresses into hub_user_wallets so the user doesn't
 * have to link manually.
 *
 * If the user has multiple addresses registered with the same email, we
 * import the most recently created one as their MiniPay wallet. Existing
 * links are not overwritten.
 */
export async function syncWalletsFromUsersTable(
  authUserId: string,
  email: string
): Promise<{ imported: number }> {
  if (!email) return { imported: 0 };

  const admin = createAdminClient();

  // Find all wallet addresses registered with this email in the users table.
  // Most recent first — the latest phone/wallet takes priority.
  const { data: rows } = await admin
    .from("users")
    .select("user_address, created_at")
    .eq("email", email)
    .order("created_at", { ascending: false });

  if (!rows || rows.length === 0) return { imported: 0 };

  // Check which addresses are already linked to this hub user
  const { data: existing } = await admin
    .from("hub_user_wallets")
    .select("address, ecosystem")
    .eq("user_id", authUserId);

  const linkedAddresses = new Set((existing ?? []).map((r) => r.address.toLowerCase()));
  const hasMinipaySlot = (existing ?? []).some((r) => r.ecosystem === "minipay");

  let imported = 0;

  for (const row of rows) {
    const address = row.user_address.toLowerCase();

    // Skip addresses already in the hub
    if (linkedAddresses.has(address)) continue;

    // The unique constraint is (user_id, ecosystem) — only one minipay wallet.
    // Use the most recent address for the minipay slot; skip the rest if taken.
    if (hasMinipaySlot) break;

    const { error } = await admin
      .from("hub_user_wallets")
      .upsert(
        { user_id: authUserId, ecosystem: "minipay", address },
        { onConflict: "user_id,ecosystem", ignoreDuplicates: true }
      );

    if (!error) {
      imported++;
      break; // Only one minipay slot; stop after filling it
    }
  }

  return { imported };
}
