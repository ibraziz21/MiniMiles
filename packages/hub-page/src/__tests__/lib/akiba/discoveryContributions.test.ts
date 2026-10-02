import { describe, expect, it } from "vitest";
import {
  verifiedEvidenceFromMilesIssuance,
  type PurchaseEventEvidence,
} from "@/lib/akiba/discoveryContributions";

const MERCHANT_ID = "20000000-0000-4000-8000-000000000002";
const CANONICAL_ID = "30000000-0000-4000-8000-000000000003";
const PURCHASE_ID = "40000000-0000-4000-8000-000000000004";

const issuance = {
  id: "50000000-0000-4000-8000-000000000005",
  canonical_id: CANONICAL_ID,
  source_id: PURCHASE_ID,
  source_type: "purchase" as const,
  created_at: "2026-09-28T10:20:45.864Z",
};

const purchase: PurchaseEventEvidence = {
  id: PURCHASE_ID,
  merchant_id: MERCHANT_ID,
  canonical_id: CANONICAL_ID,
  external_purchase_id: "scan-award-7f146",
  status: "rewarded",
  source_app: "scan_award",
  occurred_at: "2026-09-28T10:20:45.864Z",
  raw_metadata: { source: "scan_award", channel: "in_store" },
  miles_awarded: 17,
  net_miles_awarded: 17,
  miles_reversed: 0,
  refund_status: "none",
};

function resolve(purchaseEvent: PurchaseEventEvidence | null = purchase) {
  return verifiedEvidenceFromMilesIssuance({
    issuance,
    purchaseEvent,
    merchantId: MERCHANT_ID,
    canonicalIds: [CANONICAL_ID],
  });
}

describe("verifiedEvidenceFromMilesIssuance", () => {
  it("recognizes a rewarded in-store AkibaMiles purchase issuance", () => {
    expect(resolve()).toEqual({
      eventId: `purchase-event:${PURCHASE_ID}`,
      canonicalId: CANONICAL_ID,
      source: "merchant_scan",
      occurredAt: "2026-09-28T10:20:45.864Z",
      purchaseEventId: PURCHASE_ID,
      sourceItemRef: "scan-award-7f146",
    });
  });

  it("rejects an online purchase even when Miles were awarded", () => {
    expect(resolve({ ...purchase, raw_metadata: { channel: "online" } })).toBeNull();
  });

  it("rejects purchases for another merchant or member", () => {
    expect(resolve({ ...purchase, merchant_id: "other-merchant" })).toBeNull();
    expect(resolve({ ...purchase, canonical_id: "other-member" })).toBeNull();
  });

  it("rejects refunded, reversed or zero-net rewards", () => {
    expect(resolve({ ...purchase, refund_status: "refunded" })).toBeNull();
    expect(resolve({ ...purchase, miles_reversed: 17 })).toBeNull();
    expect(resolve({ ...purchase, net_miles_awarded: 0 })).toBeNull();
  });

  it("keeps legacy merchant-scan ledger credits eligible", () => {
    expect(
      verifiedEvidenceFromMilesIssuance({
        issuance: { ...issuance, source_type: "merchant" },
        purchaseEvent: null,
        merchantId: MERCHANT_ID,
        canonicalIds: [CANONICAL_ID],
      }),
    ).toEqual(expect.objectContaining({ source: "merchant_scan", canonicalId: CANONICAL_ID }));
  });

  it("rejects a ledger credit that is not linked to the signed-in member", () => {
    expect(
      verifiedEvidenceFromMilesIssuance({
        issuance,
        purchaseEvent: purchase,
        merchantId: MERCHANT_ID,
        canonicalIds: ["other-member"],
      }),
    ).toBeNull();
  });
});
