import { createAdminClient } from "@/lib/supabase/admin";
import { recordVerifiedEarningForDiscovery } from "@/lib/akiba/discoveryEarningIngestion";
import { produceMilesEarnedNotification, type MilesCreditedEvent } from "@/lib/akiba/milesEarnedNotification";

const RECONCILIATION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type ReconciliablePurchase = {
  id: string;
  canonical_id: string | null;
  merchant_id: string;
  external_purchase_id: string | null;
  source_app: string | null;
  occurred_at: string;
  raw_metadata: unknown;
  status: string;
  miles_awarded: number | string | null;
  net_miles_awarded: number | string | null;
  miles_reversed: number | string | null;
  refund_status: string | null;
  amount: number | string | null;
  currency: string | null;
};

type HubCanonical = { hub_user_id: string; canonical_id: string };
type Merchant = { id: string; name: string };

function metadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function positiveInteger(value: number | string | null): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonPositive(value: number | string | null): boolean {
  if (value === null || value === "") return true;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed <= 0;
}

/**
 * Rebuild the authoritative miles_credited contract from an already committed
 * purchase row. This is intentionally stricter than merely checking that a
 * ledger credit exists: only active, positive, explicitly in-store evidence
 * can become a verified visit.
 */
export function milesCreditedEventFromPurchase(
  purchase: ReconciliablePurchase,
  hubUserId: string,
  merchantName: string,
): MilesCreditedEvent | null {
  const milesAwarded = positiveInteger(purchase.miles_awarded);
  if (!purchase.canonical_id || !milesAwarded) return null;
  if (purchase.status !== "rewarded") return null;
  if (!positiveInteger(purchase.net_miles_awarded)) return null;
  if (!nonPositive(purchase.miles_reversed)) return null;
  if (["refunded", "reversed", "fully_refunded"].includes(purchase.refund_status ?? "")) return null;
  if (metadataString(purchase.raw_metadata, "channel") !== "in_store") return null;

  const source =
    purchase.source_app === "scan_award" || metadataString(purchase.raw_metadata, "source") === "scan_award"
      ? "merchant_scan" as const
      : "merchant_purchase" as const;

  const paidAmount = Number(purchase.amount);

  return {
    eventId: `purchase-event:${purchase.id}`,
    hubUserId,
    canonicalId: purchase.canonical_id,
    merchantId: purchase.merchant_id,
    merchantName,
    milesAwarded,
    source,
    occurredAt: purchase.occurred_at,
    purchaseEventId: purchase.id,
    channel: "in_store",
    paidAmountMinor: Number.isFinite(paidAmount) && paidAmount >= 0 ? Math.round(paidAmount * 100) : undefined,
    currency: purchase.currency ?? undefined,
    sourceItemRef: purchase.external_purchase_id || `purchase_event:${purchase.id}`,
  };
}

export type VerifiedEarningReconciliationResult = {
  scanned: number;
  eligible: number;
  reconciled: number;
  missingHubIdentity: number;
  missingMerchant: number;
};

/**
 * Safety net for a dropped Akiba-Platform miles_credited callback.
 *
 * The purchase and ledger transaction remains authoritative. This worker only
 * replays the same idempotent Hub consumers that the callback normally calls;
 * notification_outbox is deduped by event id, verified_earning_events is
 * deduped by event id, and contribution-request creation is deduped by the
 * earning event plus the existing cooldown/fatigue constraints.
 */
export async function reconcileRecentVerifiedEarnings(
  batchSize = 250,
  now = new Date(),
): Promise<VerifiedEarningReconciliationResult> {
  const admin = createAdminClient();
  const cutoff = new Date(now.getTime() - RECONCILIATION_WINDOW_MS).toISOString();
  const limit = Math.max(1, Math.min(500, Math.trunc(batchSize)));

  const { data, error } = await admin
    .from("purchase_events")
    .select(
      "id, canonical_id, merchant_id, external_purchase_id, source_app, occurred_at, raw_metadata, status, miles_awarded, net_miles_awarded, miles_reversed, refund_status, amount, currency",
    )
    .eq("status", "rewarded")
    .gte("occurred_at", cutoff)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`purchase lookup failed: ${error.message}`);
  const purchases = (data ?? []) as ReconciliablePurchase[];
  const eligiblePurchases = purchases.filter((purchase) =>
    Boolean(
      purchase.canonical_id &&
      positiveInteger(purchase.miles_awarded) &&
      positiveInteger(purchase.net_miles_awarded) &&
      nonPositive(purchase.miles_reversed) &&
      !["refunded", "reversed", "fully_refunded"].includes(purchase.refund_status ?? "") &&
      metadataString(purchase.raw_metadata, "channel") === "in_store",
    ),
  );

  const canonicalIds = [...new Set(eligiblePurchases.flatMap((purchase) => purchase.canonical_id ? [purchase.canonical_id] : []))];
  const merchantIds = [...new Set(eligiblePurchases.map((purchase) => purchase.merchant_id))];

  const [canonicalResult, merchantResult] = await Promise.all([
    canonicalIds.length > 0
      ? admin.from("hub_user_canonicals").select("hub_user_id, canonical_id").in("canonical_id", canonicalIds)
      : Promise.resolve({ data: [] as HubCanonical[], error: null }),
    merchantIds.length > 0
      ? admin.from("partners").select("id, name").in("id", merchantIds)
      : Promise.resolve({ data: [] as Merchant[], error: null }),
  ]);

  if (canonicalResult.error) throw new Error(`Hub identity lookup failed: ${canonicalResult.error.message}`);
  if (merchantResult.error) throw new Error(`merchant lookup failed: ${merchantResult.error.message}`);

  const hubUserByCanonical = new Map(
    ((canonicalResult.data ?? []) as HubCanonical[]).map((row) => [row.canonical_id, row.hub_user_id]),
  );
  const merchantNameById = new Map(
    ((merchantResult.data ?? []) as Merchant[]).map((row) => [row.id, row.name]),
  );

  let reconciled = 0;
  let missingHubIdentity = 0;
  let missingMerchant = 0;

  for (const purchase of eligiblePurchases) {
    const hubUserId = purchase.canonical_id ? hubUserByCanonical.get(purchase.canonical_id) : null;
    if (!hubUserId) {
      missingHubIdentity++;
      continue;
    }
    const merchantName = merchantNameById.get(purchase.merchant_id);
    if (!merchantName) {
      missingMerchant++;
      continue;
    }

    const event = milesCreditedEventFromPurchase(purchase, hubUserId, merchantName);
    if (!event) continue;

    // Each consumer is independently idempotent and independently guarded so
    // one unavailable optional surface never prevents the other from healing.
    try {
      await produceMilesEarnedNotification(event);
    } catch (notificationError) {
      console.error("[verified-earning-reconciliation] notification replay failed:", notificationError);
    }
    await recordVerifiedEarningForDiscovery(event, "in_store");
    reconciled++;
  }

  return {
    scanned: purchases.length,
    eligible: eligiblePurchases.length,
    reconciled,
    missingHubIdentity,
    missingMerchant,
  };
}
