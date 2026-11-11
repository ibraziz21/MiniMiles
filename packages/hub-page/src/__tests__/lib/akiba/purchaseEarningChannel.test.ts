import { beforeEach, describe, expect, it, vi } from "vitest";
const { from, query } = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  return { from: vi.fn(() => query), query };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));
import { resolvePurchaseEarningChannel } from "@/lib/akiba/purchaseEarningChannel";

const voucherId = "10000000-0000-4000-8000-000000000001";
const purchase = { merchant_id: "merchant", source_app: "merchant_voucher_checkout", raw_metadata: { voucherId } };
beforeEach(() => {
  vi.clearAllMocks();
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: { redemption_channel: "merchant_scan" }, error: null });
});
describe("resolvePurchaseEarningChannel", () => {
  it("recovers only from a redemption scoped to the voucher, merchant and member", async () => {
    expect(await resolvePurchaseEarningChannel(purchase, "member")).toBe("in_store");
    expect(query.eq.mock.calls).toEqual([
      ["issued_voucher_id", voucherId], ["merchant_id", "merchant"], ["hub_user_id", "member"],
    ]);
  });
  it("does not infer a visit from the checkout source alone", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await resolvePurchaseEarningChannel(purchase, "member")).toBe("unknown");
  });
  it("preserves explicit online evidence without a redemption lookup", async () => {
    expect(await resolvePurchaseEarningChannel({ ...purchase, raw_metadata: { voucherId, channel: "online" } }, "member")).toBe("online");
    expect(from).not.toHaveBeenCalled();
  });
  it("does not turn an online redemption into a visit", async () => {
    query.maybeSingle.mockResolvedValue({ data: { redemption_channel: "online_order" }, error: null });
    expect(await resolvePurchaseEarningChannel(purchase, "member")).toBe("online");
  });
  it("surfaces lookup errors so recovery can retry", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: { message: "offline" } });
    await expect(resolvePurchaseEarningChannel(purchase, "member")).rejects.toThrow("offline");
  });
});
