import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  rpc: vi.fn(),
  audit: vi.fn(),
  voucherRow: null as Record<string, unknown> | null,
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
          single: async () => ({ data: state.voucherRow, error: null }),
        }),
      }),
    }),
  },
}));

const route = await import("@/app/api/admin/voucher-funds/[fundId]/vouchers/[voucherId]/revoke/route");

function post(body: unknown) {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/voucher-funds/:fundId/vouchers/:voucherId/revoke", () => {
  beforeEach(() => {
    state.session = null;
    state.rpc.mockReset();
    state.audit.mockReset();
    state.voucherRow = null;
  });

  it("requires an admin session", async () => {
    const res = await route.POST(post({ reason: "fraud" }), {
      params: Promise.resolve({ fundId: "fund-1", voucherId: "v-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a missing/short reason before touching the database", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    const res = await route.POST(post({ reason: "no" }), {
      params: Promise.resolve({ fundId: "fund-1", voucherId: "v-1" }),
    });
    expect(res.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("404s when the voucher does not belong to the fund in the URL", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.voucherRow = { id: "v-1", voucher_funding_allocations: { program_id: "other-fund" } };
    const res = await route.POST(post({ reason: "fraud report confirmed" }), {
      params: Promise.resolve({ fundId: "fund-1", voucherId: "v-1" }),
    });
    expect(res.status).toBe(404);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("revokes and audits when the RPC succeeds", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.voucherRow = { id: "v-1", voucher_funding_allocations: { program_id: "fund-1" } };
    state.rpc.mockResolvedValue({ data: [{ ok: true, voucher_status: "revoked", error_code: "" }], error: null });
    const res = await route.POST(post({ reason: "confirmed fraud" }), {
      params: Promise.resolve({ fundId: "fund-1", voucherId: "v-1" }),
    });
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "revoke_akiba_funded_voucher_atomic",
      expect.objectContaining({ p_issued_voucher_id: "v-1", p_reason: "confirmed fraud" }),
    );
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "voucher.revoked" }));
  });

  it("surfaces a graceful ok:false as a 409, not a crash", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.voucherRow = { id: "v-1", voucher_funding_allocations: { program_id: "fund-1" } };
    state.rpc.mockResolvedValue({ data: [{ ok: false, voucher_status: "redeemed", error_code: "VOUCHER_NOT_REVOCABLE" }], error: null });
    const res = await route.POST(post({ reason: "confirmed fraud" }), {
      params: Promise.resolve({ fundId: "fund-1", voucherId: "v-1" }),
    });
    expect(res.status).toBe(409);
  });
});
