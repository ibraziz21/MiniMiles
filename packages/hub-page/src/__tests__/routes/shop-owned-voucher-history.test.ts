import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ status: "redeemed", redeemingId: "secondary" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "member" } } }) } }),
}));
vi.mock("@/lib/vouchers/fundedOfferMerchants.server", () => ({
  resolveSnapshotParticipants: async () => ({ merchants: [
    { id: "primary", name: "Primary", slug: "primary", imageUrl: null },
    { id: "secondary", name: "Actual trader", slug: "actual-trader", imageUrl: "/trader.png" },
  ] }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => {
    const chain = {
      select: () => chain, eq: () => chain, neq: () => chain, order: () => chain,
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({
        error: null,
        data: table === "hub_user_wallets" ? [] : [{
          id: "voucher", status: state.status,
          rules_snapshot: { title: "Original offer", voucher_type: "percent_off", discount_percent: 10, maximum_discount_kes: 200, minimum_spend_kes: 300, terms_text: "One transaction only.", eligible_merchant_ids: ["primary", "secondary", "missing"] },
          voucher_redemptions: { merchant_id: state.redeemingId },
          spend_voucher_templates: {
            id: "template", title: "Edited offer", voucher_type: "percent_off", discount_percent: 10,
            discount_cusd: null, discount_kes: null, applicable_category: null, retail_value_cusd: null,
            partners: { id: "primary", name: "Primary", slug: "primary", image_url: null },
          },
        }],
      }).then(resolve),
    };
    return chain;
  } }),
}));

const { GET } = await import("@/app/api/shop/vouchers/my/route");

describe("web wallet history", () => {
  beforeEach(() => { state.status = "redeemed"; state.redeemingId = "secondary"; });

  it("emits immutable customer conditions and expiry without exposing the raw snapshot", async () => {
    const body = await (await GET()).json();
    expect(body.vouchers[0].entitlement).toMatchObject({
      title: "Original offer", maximumDiscountKes: 200, minimumSpendKes: 300,
      terms: "One transaction only.", merchantCount: 3, merchantsIncomplete: true,
      timing: { kind: "issued" },
    });
    expect(body.vouchers[0]).not.toHaveProperty("rules_snapshot");
  });

  it("names the actual redeemer and retains the issued title and complete snapshot count", async () => {
    const body = await (await GET()).json();
    expect(body.vouchers[0]).toMatchObject({
      participantCount: 3, participantsIncomplete: true,
      spend_voucher_templates: {
        title: "Original offer",
        partners: { name: "Actual trader", slug: "actual-trader", image_url: "/trader.png" },
      },
    });
    expect(body.vouchers[0].participantMerchants).toHaveLength(2);
    expect(body.vouchers[0]).not.toHaveProperty("voucher_redemptions");
  });

  it("does not substitute the primary when the redeemer profile cannot be resolved", async () => {
    state.redeemingId = "missing";
    const body = await (await GET()).json();
    expect(body.vouchers[0].spend_voucher_templates.partners).toBeNull();
  });

  it("preserves the primary identity for an unspent voucher and reports the full scope", async () => {
    state.status = "issued";
    const body = await (await GET()).json();
    expect(body.vouchers[0].spend_voucher_templates.partners.name).toBe("Primary");
    expect(body.vouchers[0].participantCount).toBe(3);
  });
});
