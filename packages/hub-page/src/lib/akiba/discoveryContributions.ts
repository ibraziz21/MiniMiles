/**
 * Shared read for the member's next pending visit-card contribution
 * request (verified-discovery-acquisition-v1-spec.md §8.2, §11.2). Used by
 * both `GET /api/me/discovery-contributions/next` and the Hub home
 * pending-contribution nudge (§8.2 surface 2) so they show the exact same
 * request and share the same "mark as prompted" side effect — showing the
 * home nudge IS prompting the member, whichever surface does it first.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export type NextDiscoveryContributionRequest = {
  id: string;
  merchantId: string;
  merchantName: string;
  templateSnapshot: unknown;
  expiresAt: string;
};

export type MerchantContributionResolution =
  | { status: "ready"; requestId: string; issuanceFound: true }
  | { status: "no_identity" | "no_issuance"; requestId: null; issuanceFound: false }
  | { status: "lookup_failed"; requestId: null; issuanceFound: boolean }
  | { status: "issuance_not_eligible"; requestId: null; issuanceFound: true; reason: string };

const CONTRIBUTION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

type MilesLedgerIssuance = {
  id: string;
  canonical_id: string;
  source_id: string | null;
  source_type: "merchant" | "purchase";
  created_at: string;
};

export type PurchaseEventEvidence = {
  id: string;
  merchant_id: string;
  canonical_id: string;
  external_purchase_id: string | null;
  status: string;
  source_app: string | null;
  occurred_at: string;
  raw_metadata: unknown;
  miles_awarded: number | string | null;
  net_miles_awarded: number | string | null;
  miles_reversed: number | string | null;
  refund_status: string | null;
};

type VerifiedEarningEvidence = {
  eventId: string;
  canonicalId: string;
  source: "merchant_scan" | "merchant_purchase";
  occurredAt: string;
  purchaseEventId: string | null;
  sourceItemRef: string;
};

function positiveNumber(value: number | string | null): boolean {
  if (value === null || value === "") return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function nonPositiveNumber(value: number | string | null): boolean {
  if (value === null || value === "") return true;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed <= 0;
}

function metadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/**
 * Converts a committed AkibaMiles issuance into the minimum evidence stored
 * by Hub. Purchase-backed issuances are accepted only when the authoritative
 * purchase row proves the same member, merchant, positive reward and an
 * in-store channel. Keeping this pure also makes the security boundary easy
 * to regression-test.
 */
export function verifiedEvidenceFromMilesIssuance(input: {
  issuance: MilesLedgerIssuance;
  purchaseEvent: PurchaseEventEvidence | null;
  merchantId: string;
  canonicalIds: readonly string[];
}): VerifiedEarningEvidence | null {
  const { issuance, purchaseEvent, merchantId, canonicalIds } = input;
  if (!canonicalIds.includes(issuance.canonical_id)) return null;

  // Legacy merchant awards are scan awards by contract and therefore prove
  // physical presence without a companion purchase_events row.
  if (issuance.source_type === "merchant") {
    return {
      eventId: `miles-ledger:${issuance.id}`,
      canonicalId: issuance.canonical_id,
      source: "merchant_scan",
      occurredAt: issuance.created_at,
      purchaseEventId: issuance.source_id == null ? null : String(issuance.source_id),
      sourceItemRef: `miles_ledger:${issuance.id}`,
    };
  }

  if (!purchaseEvent || issuance.source_id == null) return null;
  if (String(purchaseEvent.id) !== String(issuance.source_id)) return null;
  if (purchaseEvent.merchant_id !== merchantId) return null;
  if (purchaseEvent.canonical_id !== issuance.canonical_id) return null;
  if (!canonicalIds.includes(purchaseEvent.canonical_id)) return null;
  if (purchaseEvent.status !== "rewarded") return null;
  if (!positiveNumber(purchaseEvent.net_miles_awarded)) return null;
  if (!positiveNumber(purchaseEvent.miles_awarded)) return null;
  if (!nonPositiveNumber(purchaseEvent.miles_reversed)) return null;
  if (["refunded", "reversed", "fully_refunded"].includes(purchaseEvent.refund_status ?? "")) return null;
  if (metadataString(purchaseEvent.raw_metadata, "channel") !== "in_store") return null;

  const isScanAward =
    purchaseEvent.source_app === "scan_award" ||
    metadataString(purchaseEvent.raw_metadata, "source") === "scan_award";

  return {
    eventId: `purchase-event:${purchaseEvent.id}`,
    canonicalId: purchaseEvent.canonical_id,
    source: isScanAward ? "merchant_scan" : "merchant_purchase",
    occurredAt: purchaseEvent.occurred_at,
    purchaseEventId: String(purchaseEvent.id),
    sourceItemRef: purchaseEvent.external_purchase_id || `purchase_event:${purchaseEvent.id}`,
  };
}

export async function getNextDiscoveryContributionRequest(
  hubUserId: string,
  merchantId?: string,
): Promise<NextDiscoveryContributionRequest | null> {
  const admin = createAdminClient();
  let query = admin
    .from("discovery_contribution_requests")
    .select("id, partner_id, template_snapshot, expires_at, merchant:partners(name)")
    .eq("hub_user_id", hubUserId)
    .eq("state", "open")
    .gt("expires_at", new Date().toISOString());

  if (merchantId) query = query.eq("partner_id", merchantId);

  const { data: request, error } = await query
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[discovery-contributions] next lookup failed:", error.message);
    return null;
  }
  if (!request) return null;

  await admin
    .from("discovery_contribution_requests")
    .update({ first_prompted_at: new Date().toISOString() })
    .eq("id", request.id)
    .is("first_prompted_at", null);

  return {
    id: request.id,
    merchantId: request.partner_id,
    merchantName: (request as { merchant?: { name?: string } | null }).merchant?.name ?? "this merchant",
    templateSnapshot: request.template_snapshot,
    expiresAt: request.expires_at,
  };
}

/**
 * Resolves a merchant-profile contribution entry from the authoritative
 * AkibaMiles ledger. The normal miles-credited ingestion path remains the
 * preferred producer; this is an idempotent repair path for committed
 * merchant issuances that predate it or whose delivery was missed.
 *
 * Platform currently records scan-award credits as `purchase` ledger rows,
 * linked to an authoritative `purchase_events` record. Older `merchant`
 * credits remain supported. We mirror eligible proof into
 * verified_earning_events and then call the same database function as live
 * ingestion, so merchant settings, request expiry, cooldown, fatigue limits
 * and one-open-request constraints are not bypassed.
 */
export async function resolveMerchantContributionFromMilesIssuance(input: {
  hubUserId: string;
  email: string | null;
  merchantId: string;
}): Promise<MerchantContributionResolution> {
  const existing = await getNextDiscoveryContributionRequest(input.hubUserId, input.merchantId);
  if (existing) return { status: "ready", requestId: existing.id, issuanceFound: true };

  const admin = createAdminClient();
  try {
    const { data: wallets, error: walletsError } = await admin
      .from("hub_user_wallets")
      .select("address")
      .eq("user_id", input.hubUserId)
      .eq("verification_status", "verified");

    if (walletsError) {
      console.error("[discovery-contributions] wallet lookup failed:", walletsError.message);
      return { status: "lookup_failed", requestId: null, issuanceFound: false };
    }

    const email = input.email?.trim().toLowerCase() || null;
    const walletAddresses = [...new Set(
      (wallets ?? [])
        .map((wallet: { address?: string | null }) => wallet.address?.trim().toLowerCase())
        .filter((address): address is string => Boolean(address)),
    )];

    const identityLookups: Array<PromiseLike<{
      data: Array<{ canonical_id: string }> | null;
      error: { message: string } | null;
    }>> = [];
    if (email) {
      identityLookups.push(
        admin
          .from("identity_links")
          .select("canonical_id")
          .eq("identity_type", "email")
          .eq("identity_value", email),
      );
    }
    if (walletAddresses.length > 0) {
      identityLookups.push(
        admin
          .from("identity_links")
          .select("canonical_id")
          .eq("identity_type", "wallet")
          .in("identity_value", walletAddresses),
      );
    }
    if (identityLookups.length === 0) {
      return { status: "no_identity", requestId: null, issuanceFound: false };
    }

    const identityResults = await Promise.all(identityLookups);
    const identityError = identityResults.find((result) => result.error)?.error;
    if (identityError) {
      console.error("[discovery-contributions] identity lookup failed:", identityError.message);
      return { status: "lookup_failed", requestId: null, issuanceFound: false };
    }

    const canonicalIds = [...new Set(
      identityResults.flatMap((result) => (result.data ?? []).map((row) => row.canonical_id)),
    )];
    if (canonicalIds.length === 0) {
      return { status: "no_identity", requestId: null, issuanceFound: false };
    }

    const contributionWindowStart = new Date(Date.now() - CONTRIBUTION_WINDOW_MS).toISOString();
    const { data: issuances, error: issuanceError } = await admin
      .from("miles_ledger")
      .select("id, canonical_id, source_id, source_type, created_at")
      .in("canonical_id", canonicalIds)
      .eq("partner_id", input.merchantId)
      .eq("direction", "credit")
      .in("source_type", ["merchant", "purchase"])
      .gt("amount", 0)
      .gte("created_at", contributionWindowStart)
      .order("created_at", { ascending: false })
      .limit(10);

    if (issuanceError) {
      console.error("[discovery-contributions] merchant issuance lookup failed:", issuanceError.message);
      return { status: "lookup_failed", requestId: null, issuanceFound: false };
    }
    if (!issuances || issuances.length === 0) {
      return { status: "no_issuance", requestId: null, issuanceFound: false };
    }

    const typedIssuances = issuances as MilesLedgerIssuance[];
    const purchaseIds = typedIssuances
      .filter((issuance) => issuance.source_type === "purchase" && issuance.source_id != null)
      .map((issuance) => String(issuance.source_id));

    let purchaseEvents: PurchaseEventEvidence[] = [];
    if (purchaseIds.length > 0) {
      const { data, error: purchaseEventsError } = await admin
        .from("purchase_events")
        .select(
          "id, merchant_id, canonical_id, external_purchase_id, status, source_app, occurred_at, raw_metadata, miles_awarded, net_miles_awarded, miles_reversed, refund_status",
        )
        .in("id", purchaseIds);

      if (purchaseEventsError) {
        console.error("[discovery-contributions] purchase evidence lookup failed:", purchaseEventsError.message);
        return { status: "lookup_failed", requestId: null, issuanceFound: true };
      }
      purchaseEvents = (data ?? []) as PurchaseEventEvidence[];
    }

    const purchaseEventsById = new Map(purchaseEvents.map((event) => [String(event.id), event]));
    let issuance: MilesLedgerIssuance | null = null;
    let evidence: VerifiedEarningEvidence | null = null;
    for (const candidate of typedIssuances) {
      const candidateEvidence = verifiedEvidenceFromMilesIssuance({
        issuance: candidate,
        purchaseEvent:
          candidate.source_type === "purchase" && candidate.source_id != null
            ? purchaseEventsById.get(String(candidate.source_id)) ?? null
            : null,
        merchantId: input.merchantId,
        canonicalIds,
      });
      if (candidateEvidence) {
        issuance = candidate;
        evidence = candidateEvidence;
        break;
      }
    }

    if (!issuance || !evidence) {
      return {
        status: "issuance_not_eligible",
        requestId: null,
        issuanceFound: true,
        reason: "no_eligible_purchase_evidence",
      };
    }

    const eventId = evidence.eventId;
    const { data: insertedEvent, error: eventInsertError } = await admin
      .from("verified_earning_events")
      .upsert(
        {
          event_id: eventId,
          hub_user_id: input.hubUserId,
          canonical_id: evidence.canonicalId,
          partner_id: input.merchantId,
          source: evidence.source,
          channel: "in_store",
          occurred_at: evidence.occurredAt,
          purchase_event_id: evidence.purchaseEventId,
          source_item_ref: evidence.sourceItemRef,
        },
        { onConflict: "event_id", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();

    if (eventInsertError) {
      console.error("[discovery-contributions] issuance evidence upsert failed:", eventInsertError.message);
      return { status: "lookup_failed", requestId: null, issuanceFound: true };
    }

    const earningEventId = insertedEvent?.id ?? (
      await admin
        .from("verified_earning_events")
        .select("id")
        .eq("event_id", eventId)
        .eq("hub_user_id", input.hubUserId)
        .eq("partner_id", input.merchantId)
        .maybeSingle()
    ).data?.id;

    if (!earningEventId) {
      console.error("[discovery-contributions] reconciled earning evidence could not be resolved", eventId);
      return { status: "lookup_failed", requestId: null, issuanceFound: true };
    }

    const { data: created, error: requestError } = await admin.rpc(
      "create_discovery_contribution_request",
      {
        p_earning_event_id: earningEventId,
        p_hub_user_id: input.hubUserId,
        p_partner_id: input.merchantId,
      },
    );
    if (requestError) {
      console.error("[discovery-contributions] issuance request reconciliation failed:", requestError.message);
      return { status: "lookup_failed", requestId: null, issuanceFound: true };
    }

    const result = (Array.isArray(created) ? created[0] : created) as
      | { ok?: boolean; request_id?: string | null; reason?: string | null }
      | null;
    if (result?.request_id) {
      return { status: "ready", requestId: result.request_id, issuanceFound: true };
    }

    if (result?.reason === "open_request_exists") {
      const openRequest = await getNextDiscoveryContributionRequest(input.hubUserId, input.merchantId);
      if (openRequest) return { status: "ready", requestId: openRequest.id, issuanceFound: true };
    }

    return {
      status: "issuance_not_eligible",
      requestId: null,
      issuanceFound: true,
      reason: result?.reason ?? "request_not_created",
    };
  } catch (error) {
    console.error("[discovery-contributions] issuance reconciliation failed:", error);
    return { status: "lookup_failed", requestId: null, issuanceFound: false };
  }
}
