import { beforeEach, describe, expect, it, vi } from "vitest";
import { FundedDiscoveryUnavailable, fundedDiscoveryResult } from "@/lib/vouchers/fundedDiscovery";
const state = vi.hoisted(() => ({ fail: "", rows: [] as unknown[], memberships: [] as unknown[], profiles: [] as unknown[], inventory: [] as unknown[] }));
vi.mock("@/lib/featureFlags.server", () => ({ akibaFundedVouchersHubFlag: () => ({ enabled: true }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "in", "eq", "gt", "order", "or"]) chain[name] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
      data: table === "voucher_funding_allocations" ? state.rows : table === "voucher_allocation_merchants" ? state.memberships : table === "v_voucher_funding_allocation_availability" ? state.inventory : state.profiles,
      error: table === state.fail ? { message: "Offline" } : null,
    }).then(resolve);
    return chain;
  },
}) }));
const { getFundedOffers } = await import("@/lib/vouchers/catalogue.server");
const { getMerchantFundedOffers } = await import("@/lib/vouchers/merchantFundedOffers.server");
const { resolveAllocationParticipants } = await import("@/lib/vouchers/fundedOfferMerchants.server");
describe("funded discovery availability", () => {
  beforeEach(() => { state.fail = ""; state.rows = []; state.memberships = []; state.profiles = []; state.inventory = []; });
  it("distinguishes a genuine empty catalogue from an outage", async () => {
    expect(await fundedDiscoveryResult(getFundedOffers)).toEqual({ offers: [], unavailable: false });
    state.fail = "voucher_funding_allocations";
    expect(await fundedDiscoveryResult(getFundedOffers)).toEqual({ offers: [], unavailable: true });
  });
  it("projects published campaign titles and live inventory without leaking private fund metadata", async () => {
    const program = { id: "market", state: "active", metadata: { public_campaign_title: "Karen Flea Market", notes: "Private" } };
    state.rows = ["active", "paused", "ordinary"].map((kind) => ({
      id: kind, claim_starts_at: "2026-01-01", claim_ends_at: "2099-01-01",
      voucher_funding_programs: kind === "ordinary" ? null : { ...program, state: kind },
      spend_voucher_templates: { title: "10% off", voucher_type: "percent_off", discount_percent: 10, minimum_spend_kes: 500 },
      partners: { id: "merchant", name: "Merchant", slug: "merchant", image_url: null, status: "active" },
    }));
    state.inventory = [{ allocation_id: "active", quantity_remaining: 6 }];
    const offers = await getFundedOffers();
    expect(offers.map((offer) => offer.allocationId)).toEqual(["active", "ordinary"]);
    expect(offers[0]).toMatchObject({ campaign: { id: "market", title: "Karen Flea Market" }, quantityRemaining: 6, showInBusinessOffers: true });
    expect(JSON.stringify(offers)).not.toContain("Private");
    expect(offers[1].campaign).toBeUndefined();
    expect((await getMerchantFundedOffers("merchant"))[0]).toMatchObject({ campaign: { id: "market" }, showInBusinessOffers: true });
  });
  it("keeps an individually featured voucher visible without a campaign title", async () => {
    state.rows = [{
      id: "arabica", claim_starts_at: "2026-01-01", claim_ends_at: "2099-01-01",
      metadata: { show_in_business_offers: true },
      voucher_funding_programs: { id: "arabica-fund", state: "active", metadata: null },
      spend_voucher_templates: { title: "10% off", voucher_type: "percent_off", discount_percent: 10, minimum_spend_kes: 300 },
      partners: { id: "merchant", name: "Arabica", slug: "arabica-coffee", image_url: null, status: "active" },
    }];
    const [offer] = await getFundedOffers();
    expect(offer).toMatchObject({ allocationId: "arabica", showInBusinessOffers: true });
    expect(offer.campaign).toBeUndefined();
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
