import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), rule: { program_id: "fund", mode: "all", rules: [{ type: "country_in", countries: ["KE"] }] } as Record<string, unknown> }));
vi.mock("@/lib/auth", () => ({ requireAdminSession: async () => ({ adminUserId: "admin" }), adminIdForWrite: () => "admin" }));
vi.mock("@/lib/audit", () => ({ writeAdminAuditLog: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: state.rpc, from: state.from } }));
const { PATCH } = await import("@/app/api/admin/voucher-allocations/[allocationId]/route");
function patch(extra: Record<string, unknown> = {}) {
  return PATCH(new NextRequest("http://localhost/api/admin/voucher-allocations/allocation", { method: "PATCH", body: JSON.stringify({ expectedVersion: 3, eligibilityRuleSetId: "new-policy", ...extra }) }), { params: Promise.resolve({ allocationId: "allocation" }) });
}
beforeEach(() => {
  state.rpc.mockReset().mockResolvedValue({ data: { id: "allocation" }, error: null });
  state.rule = { program_id: "fund", mode: "all", rules: [{ type: "country_in", countries: ["KE"] }, { type: "profile_country_set" }] };
  state.from.mockImplementation((table: string) => ({ select: () => ({ eq: () => ({ single: async () => ({ data: table === "voucher_funding_allocations" ? { program_id: "fund", voucher_funding_programs: { country_code: "KE" }, metadata: { redemption_schedule: { days: [6, 0], timezone: "Africa/Nairobi" }, anotherSetting: true } } : state.rule }) }) }) }));
});
describe("draft eligibility replacement", () => {
  it.each([
    [{ additionalMerchantIds: ["22222222-2222-4222-8222-222222222222"] }, ["22222222-2222-4222-8222-222222222222"]],
    [{ additionalMerchantIds: [] }, []],
    [{}, null],
  ])("forwards membership replacement, clearing and omission independently: %j", async (body, ids) => {
    expect((await patch(body)).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("update_voucher_funding_allocation_draft_with_merchants_atomic", expect.objectContaining({ p_additional_merchant_ids: ids }));
  });
  it("keeps existing redemption restrictions when only notes are edited", async () => {
    expect((await patch({ notes: "Updated note" })).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("update_voucher_funding_allocation_draft_with_merchants_atomic", expect.objectContaining({ p_metadata: { redemption_schedule: { days: [6, 0], timezone: "Africa/Nairobi" }, anotherSetting: true, notes: "Updated note" } }));
  });
  it("can explicitly remove a restriction from an unissued draft", async () => {
    expect((await patch({ redemptionSchedule: null })).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("update_voucher_funding_allocation_draft_with_merchants_atomic", expect.objectContaining({ p_metadata: { redemption_schedule: null, anotherSetting: true } }));
  });
  it("refuses to save a restricted schedule when database enforcement is unavailable", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "function not found" } });
    expect((await patch({ redemptionSchedule: { days: [6, 0], timezone: "Africa/Nairobi" } })).status).toBe(503);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc.mock.calls[0][0]).toBe("validate_funded_redemption_schedule");
  });
  it("attaches the new policy using optimistic allocation versioning", async () => {
    expect((await patch()).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("update_voucher_funding_allocation_draft_with_merchants_atomic", expect.objectContaining({ p_eligibility_rule_set_id: "new-policy", p_expected_version: 3 }));
  });
  it.each([
    { program_id: "another-fund", mode: "all", rules: [{ type: "country_in", countries: ["KE"] }] },
    { program_id: "fund", mode: "any", rules: [{ type: "country_in", countries: ["KE"] }] },
    { program_id: "fund", mode: "all", rules: [{ type: "country_in", countries: ["UG"] }] },
    { program_id: "fund", mode: "all", rules: [{ type: "pass_activated" }] },
  ])("rejects a replacement that could bypass the fund country: %j", async (rule) => {
    state.rule = rule;
    expect((await patch()).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
