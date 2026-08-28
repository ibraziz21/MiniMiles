import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  rpc: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAdminSession: async () => state.session,
  adminIdForWrite: (session: Record<string, unknown>) => session.adminUserId ?? null,
}));
vi.mock("@/lib/audit", () => ({ writeAdminAuditLog: state.audit }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: state.rpc } }));

const route = await import("@/app/api/admin/voucher-pricing/route");

function request(body: Record<string, unknown>, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/admin/voucher-pricing", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

const validBody = {
  benefitKey: "percent_10",
  selectedMilesPrice: 90,
  reason: "Mombasa launch approval",
};

describe("PATCH /api/admin/voucher-pricing", () => {
  beforeEach(() => {
    state.session = null;
    state.rpc.mockReset();
    state.audit.mockReset();
  });

  it("requires an authenticated super admin", async () => {
    expect((await route.PATCH(request(validBody))).status).toBe(401);
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    expect((await route.PATCH(request(validBody))).status).toBe(403);
    state.session = { adminUserId: "admin-1", role: "super_admin", openAccess: true };
    expect((await route.PATCH(request(validBody))).status).toBe(403);
  });

  it("rejects cross-origin and malformed updates", async () => {
    state.session = { adminUserId: "admin-1", role: "super_admin" };
    expect((await route.PATCH(request(validBody, "https://evil.example"))).status).toBe(403);
    expect((await route.PATCH(request({ ...validBody, selectedMilesPrice: 90.5 }))).status).toBe(400);
    expect((await route.PATCH(request({ ...validBody, reason: "short" }))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("creates a versioned price through the atomic RPC and audits it", async () => {
    state.session = { adminUserId: "admin-1", role: "super_admin" };
    state.rpc.mockResolvedValue({
      data: [{
        pricing_policy_version_id: "policy-2",
        benefit_key: "percent_10",
        display_name: "10% Off",
        minimum_miles_price: 75,
        maximum_miles_price: 100,
        selected_miles_price: 90,
        effective_from: "2026-08-28T10:00:00Z",
      }],
      error: null,
    });

    const response = await route.PATCH(request(validBody));
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("set_platform_voucher_price_atomic", {
      p_benefit_key: "percent_10",
      p_selected_miles_price: 90,
      p_admin_user_id: "admin-1",
      p_change_reason: "Mombasa launch approval",
    });
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
      adminUserId: "admin-1",
      action: "voucher_pricing.updated",
      targetId: "policy-2",
    }));
  });

  it("maps an out-of-band database rejection", async () => {
    state.session = { adminUserId: "admin-1", role: "super_admin" };
    state.rpc.mockResolvedValue({ data: null, error: { message: "VOUCHER_PRICE_OUTSIDE_APPROVED_BAND" } });
    const response = await route.PATCH(request({ ...validBody, selectedMilesPrice: 101 }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("outside the approved Miles band");
    expect(state.audit).not.toHaveBeenCalled();
  });
});
