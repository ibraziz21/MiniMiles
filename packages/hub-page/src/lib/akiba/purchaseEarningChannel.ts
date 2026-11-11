import { createAdminClient } from "@/lib/supabase/admin";
import type { EarningChannel } from "./discoveryEarningIngestion";

type Purchase = { merchant_id: string; source_app: string | null; raw_metadata: unknown };

// Till source labels — the in-store evidence. Akiba-Platform accepts them only
// from the merchant till's signed server requests (Platform
// lib/tillAttestation.ts, lib/purchaseRewards.ts TILL_SOURCE_APPS), so unlike
// a caller's own metadata they can't be claimed by a partner API key or a
// merchant calling the API directly. Keep this list in step with Platform's.
// merchant_voucher_checkout is handled separately below: it is written by the
// redemption function itself and confirmed against the redemption row.
const TILL_SOURCE_APPS = new Set(["scan_award", "merchant_dashboard", "merchant_scan"]);

/**
 * How a purchase was made, for verified-visit recommendations. The same rule
 * as Akiba-Platform's notification worker (lib/milesNotificationDelivery.ts
 * purchaseChannel):
 *   - in store only on server-recorded evidence: a till source label, or a
 *     voucher checkout whose redemption row says merchant_scan;
 *   - the caller's own `channel` tag is never evidence of in store — it is
 *     stored as sent, so anyone could write "in_store" there;
 *   - it may still say "online", which only ever withholds a recommendation;
 *   - a till label the payload contradicts ("online") is unknown.
 */
export async function resolvePurchaseEarningChannel(purchase: Purchase, hubUserId: string): Promise<EarningChannel> {
  const metadata = purchase.raw_metadata && typeof purchase.raw_metadata === "object" && !Array.isArray(purchase.raw_metadata)
    ? purchase.raw_metadata as Record<string, unknown> : {};
  const source = (purchase.source_app ?? "").trim().toLowerCase();
  const taggedOnline = metadata.channel === "online";

  if (TILL_SOURCE_APPS.has(source)) return taggedOnline ? "unknown" : "in_store";
  if (taggedOnline) return "online";
  if (source !== "merchant_voucher_checkout") return "unknown";
  if (typeof metadata.voucherId !== "string") return "unknown";
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
