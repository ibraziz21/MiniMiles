import { createAdminClient } from "@/lib/supabase/admin";
import type { EarningChannel } from "./discoveryEarningIngestion";

/**
 * What a purchase proves about a member's visit, from Akiba-Platform's
 * purchase_visit_evidence (migration 172). That one database function is the
 * rule for the Platform notification worker, the miles-credited endpoint,
 * reconciliation and on-demand recovery, so none of them can accept evidence
 * another would refuse:
 *
 *   ownership — the purchase's recorded recipient is this member (canonical
 *     identity, or a recorded identity matching their email, phone or verified wallet);
 *   in store — a till purchase with a proof row written in the same
 *     transaction as its award (never a source label or metadata alone), or a
 *     voucher checkout whose redemption row for this purchase says
 *     merchant_scan.
 */
export type PurchaseEvidence = {
  found: boolean;
  owned: boolean;
  ownership:
    | "owned_canonical"
    | "owned_identity"
    | "purchase_not_found"
    | "merchant_mismatch"
    | "member_identity_unavailable"
    | "recipient_mismatch";
  channel: EarningChannel;
};

/** Throws on a database error, so callers can retry rather than treat it as "no". */
export async function loadPurchaseEvidence(
  purchaseEventId: string,
  hubUserId: string,
  merchantId: string | null,
): Promise<PurchaseEvidence> {
  const { data, error } = await createAdminClient().rpc("purchase_visit_evidence", {
    p_purchase_event_id: purchaseEventId,
    p_hub_user_id: hubUserId,
    p_merchant_id: merchantId,
  });
  if (error) throw new Error(`purchase evidence lookup failed: ${error.message}`);
  const row = (data ?? {}) as Partial<PurchaseEvidence>;
  const channel: EarningChannel = row.channel === "in_store" || row.channel === "online" ? row.channel : "unknown";
  return {
    found: row.found === true,
    owned: row.owned === true,
    ownership: (row.ownership ?? "purchase_not_found") as PurchaseEvidence["ownership"],
    // Defence in depth: a channel only ever counts for the member's own purchase.
    channel: row.owned === true ? channel : "unknown",
  };
}

/** The channel of the member's own purchase; "unknown" for anyone else's. */
export async function resolvePurchaseEarningChannel(
  purchase: { id: string; merchant_id: string },
  hubUserId: string,
): Promise<EarningChannel> {
  return (await loadPurchaseEvidence(purchase.id, hubUserId, purchase.merchant_id)).channel;
}
