import { describe, expect, it } from "vitest";
import {
  milesCreditedEventFromPurchase,
  type ReconciliablePurchase,
} from "@/lib/akiba/verifiedEarningReconciliation";

const purchase: ReconciliablePurchase = {
  id: "10000000-0000-4000-8000-000000000001",
  canonical_id: "20000000-0000-4000-8000-000000000002",
  merchant_id: "30000000-0000-4000-8000-000000000003",
  external_purchase_id: null,
  source_app: "scan_award",
  occurred_at: "2026-10-17T14:11:42.216Z",
  raw_metadata: { source: "scan_award", channel: "in_store" },
  status: "rewarded",
  miles_awarded: 5,
  net_miles_awarded: 5,
  miles_reversed: 0,
  refund_status: "none",
  amount: 0,
  currency: "KES",
};

describe("milesCreditedEventFromPurchase", () => {
  it("reconstructs the idempotent event for a committed in-store scan award", () => {
    expect(milesCreditedEventFromPurchase(purchase, "hub-user-1", "Arabica")).toEqual({
      eventId: `purchase-event:${purchase.id}`,
      hubUserId: "hub-user-1",
      canonicalId: purchase.canonical_id,
      merchantId: purchase.merchant_id,
      merchantName: "Arabica",
      milesAwarded: 5,
      source: "merchant_scan",
      occurredAt: purchase.occurred_at,
      purchaseEventId: purchase.id,
      channel: "in_store",
      paidAmountMinor: 0,
      currency: "KES",
      sourceItemRef: `purchase_event:${purchase.id}`,
    });
  });

  it("rejects online, reversed, refunded and non-positive rewards", () => {
    expect(milesCreditedEventFromPurchase(
      { ...purchase, raw_metadata: { channel: "online" } },
      "hub-user-1",
      "Arabica",
    )).toBeNull();
    expect(milesCreditedEventFromPurchase(
      { ...purchase, miles_reversed: 5 },
      "hub-user-1",
      "Arabica",
    )).toBeNull();
    expect(milesCreditedEventFromPurchase(
      { ...purchase, refund_status: "refunded" },
      "hub-user-1",
      "Arabica",
    )).toBeNull();
    expect(milesCreditedEventFromPurchase(
      { ...purchase, net_miles_awarded: 0 },
      "hub-user-1",
      "Arabica",
    )).toBeNull();
  });

  it("requires an authoritative canonical identity", () => {
    expect(milesCreditedEventFromPurchase(
      { ...purchase, canonical_id: null },
      "hub-user-1",
      "Arabica",
    )).toBeNull();
  });
});
