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
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: state.rpc } }));

const route = await import("@/app/api/admin/voucher-allocations/[allocationId]/route");

function del() {
  return new NextRequest("http://localhost/x", { method: "DELETE" });
}

describe("DELETE /api/admin/voucher-allocations/:allocationId", () => {
  beforeEach(() => {
    state.session = null;
    state.rpc.mockReset();
    state.audit.mockReset();
  });

  it("requires an admin session", async () => {
    const res = await route.DELETE(del(), { params: Promise.resolve({ allocationId: "alloc-1" }) });
    expect(res.status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("calls the delete-draft RPC and audits on success", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.rpc.mockResolvedValue({ data: true, error: null });
    const res = await route.DELETE(del(), { params: Promise.resolve({ allocationId: "alloc-1" }) });
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "delete_voucher_funding_allocation_draft_atomic",
      expect.objectContaining({ p_allocation_id: "alloc-1", p_actor_id: "admin-1" }),
    );
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "voucher_allocation.deleted" }));
  });

  it("maps ALLOCATION_NOT_DRAFT to a 409 with an admin-safe message, and does not audit", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.rpc.mockResolvedValue({ data: null, error: { message: "ALLOCATION_NOT_DRAFT" } });
    const res = await route.DELETE(del(), { params: Promise.resolve({ allocationId: "alloc-1" }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/draft allocation can be deleted/i);
    expect(state.audit).not.toHaveBeenCalled();
  });
});
