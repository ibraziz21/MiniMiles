import { createAdminClient } from "@/lib/supabase/admin";

/**
 * All wallet addresses linked to a hub user, lowercased. Order ownership
 * checks must consider every linked wallet, not just the first — a user can
 * have placed an order under any of them.
 */
export async function getOwnedAddresses(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<string[]> {
  const { data } = await admin.from("hub_user_wallets").select("address").eq("user_id", userId);
  return (data ?? []).map((r: { address: string }) => r.address.toLowerCase());
}

/** Matches an order's user_address against any linked wallet, email, or user id. */
export function ownsOrder(
  orderUserAddress: string | null | undefined,
  user: { id: string; email?: string | null },
  ownedAddresses: string[]
): boolean {
  if (!orderUserAddress) return false;
  return (
    ownedAddresses.includes(orderUserAddress.toLowerCase()) ||
    user.email === orderUserAddress ||
    user.id === orderUserAddress
  );
}
