import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
import { loadPurchaseEvidence, resolvePurchaseEarningChannel } from "@/lib/akiba/purchaseEarningChannel";

// The rule itself lives in SQL (Akiba-Platform 172, purchase_visit_evidence)
// and is tested against the real award chain in
// __tests__/integration/till-proof-and-visit-evidence.test.ts. These check
// the Hub's reading of its answer.
beforeEach(() => rpc.mockReset());

describe("loadPurchaseEvidence", () => {
  it("asks the shared evidence function about this purchase, member and merchant", async () => {
    rpc.mockResolvedValue({ data: { found: true, owned: true, ownership: "owned_canonical", channel: "in_store" }, error: null });
    expect(await loadPurchaseEvidence("p1", "member", "merchant")).toEqual({
      found: true, owned: true, ownership: "owned_canonical", channel: "in_store",
    });
    expect(rpc).toHaveBeenCalledWith("purchase_visit_evidence", {
      p_purchase_event_id: "p1", p_hub_user_id: "member", p_merchant_id: "merchant",
    });
  });

  it("never passes on a channel for a purchase the member doesn't own", async () => {
    rpc.mockResolvedValue({ data: { found: true, owned: false, ownership: "recipient_mismatch", channel: "in_store" }, error: null });
    expect(await loadPurchaseEvidence("p1", "member", "merchant")).toMatchObject({ owned: false, channel: "unknown" });
  });

  it("throws on a database error so the caller can retry", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    await expect(loadPurchaseEvidence("p1", "member", null)).rejects.toThrow(/connection reset/);
  });
});

describe("resolvePurchaseEarningChannel", () => {
  it("is the owned purchase's channel, and unknown otherwise", async () => {
    rpc.mockResolvedValueOnce({ data: { found: true, owned: true, ownership: "owned_identity", channel: "online" }, error: null });
    expect(await resolvePurchaseEarningChannel({ id: "p1", merchant_id: "m" }, "member")).toBe("online");
    rpc.mockResolvedValueOnce({ data: { found: false, owned: false, ownership: "purchase_not_found", channel: "unknown" }, error: null });
    expect(await resolvePurchaseEarningChannel({ id: "p2", merchant_id: "m" }, "member")).toBe("unknown");
  });
});
