/**
 * Fail-closed behaviour of the v1 client-compatibility guard.
 *
 * The route tests mock this function away — they assert the route refuses
 * correctly — so its own decisions are covered here. Everything hinges on one
 * rule: an **unknown** shape is never treated as a supported one.
 *
 * Two values made that easy to get wrong:
 *
 *  - a missing `voucher_type` is not "not a percentage", it is an unreadable
 *    benefit;
 *  - a `null` count is not "zero extra merchants", it is a count that did not
 *    come back.
 *
 * Both previously fell through to supported, which would hand a build a
 * voucher it cannot describe. And neither is a reason to tell the member to
 * update their app, so they resolve to unavailability rather than an
 * unsupported shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Result = { data?: unknown; error?: { message: string } | null; count?: number | null };

const state = vi.hoisted(() => ({
  allocation: { data: null as unknown, error: null as { message: string } | null },
  merchantCount: { count: 0 as number | null, error: null as { message: string } | null },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) chain[method] = () => chain;
      if (table === "voucher_funding_allocations") {
        chain.maybeSingle = async (): Promise<Result> => state.allocation;
      } else {
        // head/count query resolves directly off the builder
        chain.then = (resolve: (v: Result) => unknown) => Promise.resolve(state.merchantCount).then(resolve);
      }
      return chain;
    },
  }),
}));

const { v1ClaimSupport } = await import("@/lib/vouchers/fundedOfferMerchants.server");

function allocation(voucherType: string | null) {
  return { data: { id: "alloc-1", spend_voucher_templates: { voucher_type: voucherType } }, error: null };
}

describe("v1ClaimSupport", () => {
  beforeEach(() => {
    state.allocation = allocation("fixed_off");
    state.merchantCount = { count: 0, error: null };
    delete process.env.AKIBA_PERCENT_FUNDED_OFFERS_V1_ENABLED;
    delete process.env.MULTI_MERCHANT_FUNDED_OFFERS_V1_ENABLED;
  });

  afterEach(() => {
    delete process.env.AKIBA_PERCENT_FUNDED_OFFERS_V1_ENABLED;
    delete process.env.MULTI_MERCHANT_FUNDED_OFFERS_V1_ENABLED;
  });

  it("supports a single-merchant fixed offer with both flags off", async () => {
    await expect(v1ClaimSupport("alloc-1")).resolves.toEqual({ supported: true });
  });

  it("treats a missing voucher type as unavailable, not as 'not a percentage'", async () => {
    state.allocation = allocation(null);
    await expect(v1ClaimSupport("alloc-1")).resolves.toEqual({
      supported: false,
      kind: "unavailable",
      reason: "voucher_type_unknown",
    });
  });

  it("treats a missing template as unavailable", async () => {
    state.allocation = { data: { id: "alloc-1", spend_voucher_templates: null }, error: null };
    await expect(v1ClaimSupport("alloc-1")).resolves.toMatchObject({
      supported: false,
      kind: "unavailable",
    });
  });

  it("treats a null merchant count as unavailable, not as zero extras", async () => {
    state.merchantCount = { count: null, error: null };
    await expect(v1ClaimSupport("alloc-1")).resolves.toEqual({
      supported: false,
      kind: "unavailable",
      reason: "merchant_count_unknown",
    });
  });

  it("reports a lookup failure as unavailable rather than a stale app", async () => {
    state.allocation = { data: null, error: { message: "boom" } };
    const result = await v1ClaimSupport("alloc-1");
    expect(result).toEqual({
      supported: false,
      kind: "unavailable",
      reason: "support_lookup_failed",
    });
    // Never the capability error: that would tell the member to update their
    // app over a transient database problem.
    expect(result).not.toMatchObject({ kind: "unsupported_shape" });
  });

  it("reports a count failure as unavailable", async () => {
    state.merchantCount = { count: null, error: { message: "boom" } };
    await expect(v1ClaimSupport("alloc-1")).resolves.toEqual({
      supported: false,
      kind: "unavailable",
      reason: "merchant_count_failed",
    });
  });

  it("reports a missing allocation as unavailable", async () => {
    state.allocation = { data: null, error: null };
    await expect(v1ClaimSupport("alloc-1")).resolves.toEqual({
      supported: false,
      kind: "unavailable",
      reason: "allocation_not_found",
    });
  });

  it("refuses a percentage offer as an unsupported shape while its flag is off", async () => {
    state.allocation = allocation("percent_off");
    await expect(v1ClaimSupport("alloc-1")).resolves.toEqual({
      supported: false,
      kind: "unsupported_shape",
      reason: "percentage_offer_unsupported",
    });
  });

  it("refuses a multi-merchant offer as an unsupported shape while its flag is off", async () => {
    state.merchantCount = { count: 2, error: null };
    await expect(v1ClaimSupport("alloc-1")).resolves.toEqual({
      supported: false,
      kind: "unsupported_shape",
      reason: "multi_merchant_offer_unsupported",
    });
  });

  it("gates the two shapes independently", async () => {
    state.allocation = allocation("percent_off");
    state.merchantCount = { count: 2, error: null };

    process.env.AKIBA_PERCENT_FUNDED_OFFERS_V1_ENABLED = "true";
    // Percentage allowed, multi-merchant still not.
    await expect(v1ClaimSupport("alloc-1")).resolves.toMatchObject({
      reason: "multi_merchant_offer_unsupported",
    });

    process.env.MULTI_MERCHANT_FUNDED_OFFERS_V1_ENABLED = "true";
    await expect(v1ClaimSupport("alloc-1")).resolves.toEqual({ supported: true });
  });
});
