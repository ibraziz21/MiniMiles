import { createAdminClient } from "@/lib/supabase/admin";

export type ProfileStats = {
  placesVisited: number;
  rewardsUsed: number;
};

/**
 * Small, truthful profile counters.
 *
 * "Places visited" only counts distinct merchants backed by an active,
 * verified in-store earning event. A directory view, directions tap, or
 * online order never becomes a visit by implication.
 *
 * "Rewards used" counts vouchers with a real redeemed_at timestamp. This
 * survives later reconciliation/status changes and avoids counting issued
 * or expired vouchers as used.
 */
export async function getProfileStats(opts: {
  userId: string;
  walletAddresses: string[];
}): Promise<ProfileStats> {
  const { userId, walletAddresses } = opts;
  const admin = createAdminClient();

  let rewardsQuery = admin
    .from("issued_vouchers")
    .select("id", { count: "exact", head: true })
    .not("redeemed_at", "is", null);

  rewardsQuery = walletAddresses.length > 0
    ? rewardsQuery.or(`hub_user_id.eq.${userId},user_address.in.(${walletAddresses.join(",")})`)
    : rewardsQuery.eq("hub_user_id", userId);

  const [visitsResult, rewardsResult] = await Promise.allSettled([
    admin
      .from("verified_earning_events")
      .select("partner_id")
      .eq("hub_user_id", userId)
      .eq("channel", "in_store")
      .eq("verification_status", "active"),
    rewardsQuery,
  ]);

  let placesVisited = 0;
  if (visitsResult.status === "fulfilled") {
    if (visitsResult.value.error) {
      console.error("[profileStats] visits query failed:", visitsResult.value.error.message);
    } else {
      placesVisited = new Set(
        (visitsResult.value.data ?? []).map((row: { partner_id: string }) => row.partner_id),
      ).size;
    }
  } else {
    console.error("[profileStats] visits query threw:", visitsResult.reason);
  }

  let rewardsUsed = 0;
  if (rewardsResult.status === "fulfilled") {
    if (rewardsResult.value.error) {
      console.error("[profileStats] rewards query failed:", rewardsResult.value.error.message);
    } else {
      rewardsUsed = rewardsResult.value.count ?? 0;
    }
  } else {
    console.error("[profileStats] rewards query threw:", rewardsResult.reason);
  }

  return { placesVisited, rewardsUsed };
}
