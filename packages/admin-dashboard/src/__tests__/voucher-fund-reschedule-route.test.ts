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

const route = await import("@/app/api/admin/voucher-funds/[fundId]/reschedule/route");

function post(body: unknown) {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/voucher-funds/:fundId/reschedule", () => {
  beforeEach(() => {
    state.session = null;
    state.rpc.mockReset();
    state.audit.mockReset();
  });

  it("requires an admin session", async () => {
    const res = await route.POST(post({}), { params: Promise.resolve({ fundId: "fund-1" }) });
    expect(res.status).toBe(401);
  });

  it("rejects a missing reason before calling the RPC", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    const res = await route.POST(
      post({ startsAt: "2026-09-22T00:00:00Z", endsAt: "2026-09-30T00:00:00Z", expectedVersion: 1 }),
      { params: Promise.resolve({ fundId: "fund-1" }) },
    );
    expect(res.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("calls the reschedule RPC and audits on success", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.rpc.mockResolvedValue({ data: { id: "fund-1", state: "active" }, error: null });
    const res = await route.POST(
      post({
        startsAt: "2026-09-22T00:00:00Z",
        endsAt: "2026-09-30T00:00:00Z",
        expectedVersion: 1,
        reason: "wrong date entered at creation",
      }),
      { params: Promise.resolve({ fundId: "fund-1" }) },
    );
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "reschedule_voucher_funding_program_atomic",
      expect.objectContaining({
        p_program_id: "fund-1",
        p_expected_version: 1,
        p_starts_at: "2026-09-22T00:00:00Z",
        p_ends_at: "2026-09-30T00:00:00Z",
        p_reason: "wrong date entered at creation",
      }),
    );
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "voucher_fund.rescheduled" }));
  });

  it("maps PROGRAM_NOT_RESCHEDULABLE to a 409 with an admin-safe message", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.rpc.mockResolvedValue({ data: null, error: { message: "PROGRAM_NOT_RESCHEDULABLE" } });
    const res = await route.POST(
      post({ startsAt: "2026-09-22T00:00:00Z", endsAt: "2026-09-30T00:00:00Z", expectedVersion: 1, reason: "test" }),
      { params: Promise.resolve({ fundId: "fund-1" }) },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/rescheduled/i);
  });
});
