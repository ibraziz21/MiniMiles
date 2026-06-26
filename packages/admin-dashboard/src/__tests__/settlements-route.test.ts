import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
vi.mock("@/lib/supabase", () => {
  const rows: Record<string, unknown[]> = {
    v_partner_voucher_payable_balances: [{ partner_id: "partner-1", pending_amount: 4 }],
    v_unbatched_voucher_payables: [{ id: "entry-1", merchant_id: "partner-1", payable_amount: 4 }],
    v_partner_settlement_batches: [{ id: "batch-1", partner_id: "partner-1", state: "draft" }],
    v_open_voucher_reconciliation_incidents: [{ id: "incident-1", type: "ambiguous" }],
  };
  function chain(table: string) {
    const result = { data: rows[table] ?? [], error: null };
    const value: Record<string, unknown> = {
      select: () => value,
      order: () => value,
      limit: () => value,
      then: (resolve: (arg: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return value;
  }
  return { supabase: { from: (table: string) => chain(table), rpc: state.rpc } };
});

const route = await import("@/app/api/admin/settlements/route");

describe("admin settlement route", () => {
  beforeEach(() => {
    state.session = null;
    state.rpc.mockReset();
    state.audit.mockReset();
  });

  it("requires an admin session", async () => {
    expect((await route.GET()).status).toBe(401);
    const response = await route.POST(new NextRequest("http://localhost/api/admin/settlements", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "transition" }),
    }));
    expect(response.status).toBe(401);
  });

  it("returns only the explicit safe settlement projections", async () => {
    state.session = { adminUserId: "admin-1", role: "finance_admin" };
    const response = await route.GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("payment_evidence");
    expect(JSON.stringify(body)).not.toContain("rules_snapshot");
    expect(JSON.stringify(body)).not.toContain("user_address");
  });

  it("uses the service RPC and writes an admin audit row", async () => {
    state.session = { adminUserId: "admin-1", role: "finance_admin" };
    state.rpc.mockResolvedValue({ data: [{ ok: true }], error: null });
    const response = await route.POST(new NextRequest("http://localhost/api/admin/settlements", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "transition", batch_id: "batch-1", state: "approved" }),
    }));
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("transition_partner_settlement_batch", expect.objectContaining({
      p_batch_id: "batch-1", p_new_state: "approved", p_actor_id: "admin-1",
    }));
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "settlement.transition", targetId: "batch-1",
    }));
  });
});
