import { createAdminClient } from "@/lib/supabase/admin";
import type { EarningChannel } from "./discoveryEarningIngestion";

type Purchase = { merchant_id: string; source_app: string | null; raw_metadata: unknown };

/** Missing channel metadata is recoverable only from the same member's
 * committed merchant-scan redemption, never from the checkout name alone. */
export async function resolvePurchaseEarningChannel(purchase: Purchase, hubUserId: string): Promise<EarningChannel> {
  const metadata = purchase.raw_metadata && typeof purchase.raw_metadata === "object" && !Array.isArray(purchase.raw_metadata)
    ? purchase.raw_metadata as Record<string, unknown> : {};
  if (metadata.channel === "in_store" || metadata.channel === "online") return metadata.channel;
  if (purchase.source_app !== "merchant_voucher_checkout" || typeof metadata.voucherId !== "string") return "unknown";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(metadata.voucherId)) return "unknown";

  const { data, error } = await createAdminClient()
    .from("voucher_redemptions")
    .select("redemption_channel")
    .eq("issued_voucher_id", metadata.voucherId)
    .eq("merchant_id", purchase.merchant_id)
    .eq("hub_user_id", hubUserId)
    .maybeSingle();
  if (error) throw new Error(`redemption channel lookup failed: ${error.message}`);
  return data?.redemption_channel === "merchant_scan" ? "in_store"
    : data?.redemption_channel === "online_order" ? "online" : "unknown";
}
