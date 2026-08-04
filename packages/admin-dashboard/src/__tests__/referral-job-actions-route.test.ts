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

const route = await import("@/app/api/admin/referrals/jobs/[id]/route");

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/referrals/jobs/job-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/referrals/jobs/[id]", () => {
  beforeEach(() => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.rpc.mockReset();
    state.audit.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    state.session = null;
    const res = await route.PATCH(makeRequest({ action: "requeue", reason: "ok" }), { params: { id: "job-1" } });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown action before calling any RPC", async () => {
    const res = await route.PATCH(makeRequest({ action: "delete", reason: "ok" }), { params: { id: "job-1" } });
    expect(res.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("requires a non-empty reason", async () => {
    const res = await route.PATCH(makeRequest({ action: "void", reason: "  " }), { params: { id: "job-1" } });
    expect(res.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("maps 'requeue' to admin_requeue_referral_reward_job and writes an audit entry", async () => {
    state.rpc.mockResolvedValue({ data: true, error: null });
    const res = await route.PATCH(makeRequest({ action: "requeue", reason: "false positive" }), { params: { id: "job-1" } });

    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("admin_requeue_referral_reward_job", {
      p_job_id: "job-1",
      p_reason: "false positive",
    });
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "referral.job.requeue", targetId: "job-1" }),
    );
  });

  it("maps 'reverse' to admin_reverse_referral_reward_job", async () => {
    state.rpc.mockResolvedValue({ data: true, error: null });
    await route.PATCH(makeRequest({ action: "reverse", reason: "chargeback confirmed" }), { params: { id: "job-1" } });

    expect(state.rpc).toHaveBeenCalledWith("admin_reverse_referral_reward_job", {
      p_job_id: "job-1",
      p_reason: "chargeback confirmed",
    });
  });

  it("returns 409 when the RPC reports the job wasn't in an eligible state (data !== true)", async () => {
    state.rpc.mockResolvedValue({ data: false, error: null });
    const res = await route.PATCH(makeRequest({ action: "void", reason: "dup" }), { params: { id: "job-1" } });
    expect(res.status).toBe(409);
    expect(state.audit).not.toHaveBeenCalled();
  });
});
