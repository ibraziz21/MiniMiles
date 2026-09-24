import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  rpc: vi.fn(),
  audit: vi.fn(),
  fundRow: { country_code: "KE" } as { country_code: string } | null,
}));

vi.mock("@/lib/auth", () => ({
  requireAdminSession: async () => state.session,
  adminIdForWrite: (session: Record<string, unknown>) => session.adminUserId ?? null,
}));
vi.mock("@/lib/audit", () => ({ writeAdminAuditLog: state.audit }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: state.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: state.fundRow, error: state.fundRow ? null : { message: "not found" } }),
        }),
      }),
    }),
  },
}));

const route = await import("@/app/api/admin/voucher-funds/[fundId]/eligibility-rule-sets/route");

function post(body: unknown) {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/voucher-funds/:fundId/eligibility-rule-sets", () => {
  beforeEach(() => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.fundRow = { country_code: "KE" };
    state.rpc.mockReset();
    state.audit.mockReset();
    state.rpc.mockResolvedValue({ data: { id: "rules-1" }, error: null });
  });

  it("rejects any-mode because it could bypass the country gate", async () => {
    const res = await route.POST(
      post({ mode: "any", rules: [{ type: "pass_activated" }] }),
      { params: Promise.resolve({ fundId: "fund-1" }) },
    );

    expect(res.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("replaces a caller-supplied country with the fund country and requires all rules", async () => {
    const res = await route.POST(
      post({
        mode: "all",
        rules: [
          { type: "country_in", countries: ["UG"] },
          { type: "pass_activated" },
        ],
      }),
      { params: Promise.resolve({ fundId: "fund-1" }) },
    );

    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "create_voucher_eligibility_rule_set_atomic",
      expect.objectContaining({
        p_mode: "all",
        p_rules: [
          { type: "country_in", countries: ["KE"] },
          { type: "pass_activated" },
        ],
      }),
    );
  });
});
