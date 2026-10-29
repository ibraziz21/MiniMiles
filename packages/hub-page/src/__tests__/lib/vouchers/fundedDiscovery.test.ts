import { beforeEach, describe, expect, it, vi } from "vitest";
import { FundedDiscoveryUnavailable, fundedDiscoveryResult } from "@/lib/vouchers/fundedDiscovery";
const state = vi.hoisted(() => ({ fail: "", rows: [] as unknown[], memberships: [] as unknown[], profiles: [] as unknown[] }));
vi.mock("@/lib/featureFlags.server", () => ({ akibaFundedVouchersHubFlag: () => ({ enabled: true }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "in", "eq", "gt", "order", "or"]) chain[name] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
      data: table === "voucher_funding_allocations" ? state.rows : table === "voucher_allocation_merchants" ? state.memberships : state.profiles,
      error: table === state.fail ? { message: "Offline" } : null,
    }).then(resolve);
    return chain;
  },
}) }));
const { getFundedOffers } = await import("@/lib/vouchers/catalogue.server");
const { getMerchantFundedOffers } = await import("@/lib/vouchers/merchantFundedOffers.server");
const { resolveAllocationParticipants } = await import("@/lib/vouchers/fundedOfferMerchants.server");
describe("funded discovery availability", () => {
  beforeEach(() => { state.fail = ""; state.rows = []; state.memberships = []; state.profiles = []; });
  it("distinguishes a genuine empty catalogue from an outage", async () => {
    expect(await fundedDiscoveryResult(getFundedOffers)).toEqual({ offers: [], unavailable: false });
    state.fail = "voucher_funding_allocations";
    expect(await fundedDiscoveryResult(getFundedOffers)).toEqual({ offers: [], unavailable: true });
  });
  it("fails merchant discovery closed when secondary membership lookup fails", async () => {
    state.fail = "voucher_allocation_merchants";
    await expect(getMerchantFundedOffers("a")).rejects.toBeInstanceOf(FundedDiscoveryUnavailable);
  });
  it("never converts unknown membership into a one-merchant offer", async () => {
    state.fail = "voucher_allocation_merchants";
    await expect(resolveAllocationParticipants(new Map([["allocation", { id: "a", name: "A", slug: "a", imageUrl: null }]]))).rejects.toMatchObject({ stage: "memberships", allocationIds: ["allocation"] });
  });
  it("does not show a smaller offer when a named profile is missing", async () => {
    state.memberships = [{ allocation_id: "allocation", partner_id: "b" }];
    await expect(resolveAllocationParticipants(new Map([["allocation", { id: "a", name: "A", slug: "a", imageUrl: null }]]))).rejects.toMatchObject({ stage: "participant_incomplete", allocationIds: ["allocation"] });
  });
  it("distinguishes a profile-query outage from an empty participant set", async () => {
    state.memberships = [{ allocation_id: "allocation", partner_id: "b" }]; state.fail = "partners";
    await expect(resolveAllocationParticipants(new Map([["allocation", { id: "a", name: "A", slug: "a", imageUrl: null }]]))).rejects.toMatchObject({ stage: "participant_profiles" });
  });
  it("preserves a genuinely single-merchant participant set", async () => {
    const a = { id: "a", name: "A", slug: "a", imageUrl: null };
    expect((await resolveAllocationParticipants(new Map([["allocation", a]]))).get("allocation")).toEqual([a]);
  });
  it("does not hide programming errors as availability failures", async () => {
    await expect(fundedDiscoveryResult(async () => { throw new TypeError("Bug"); })).rejects.toThrow("Bug");
  });
});
