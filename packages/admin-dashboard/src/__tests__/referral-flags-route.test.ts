import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  updateError: null as { message?: string } | null,
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAdminSession: async () => state.session,
  adminIdForWrite: (session: Record<string, unknown>) => session.adminUserId ?? null,
}));
vi.mock("@/lib/audit", () => ({ writeAdminAuditLog: state.audit }));
vi.mock("@/lib/supabase", () => {
  function chain() {
    const value: Record<string, unknown> = {
      update: () => value,
      eq: async () => ({ error: state.updateError }),
    };
    return value;
  }
  return { supabase: { from: () => chain() } };
});

const route = await import("@/app/api/admin/referrals/flags/[key]/route");

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/referrals/flags/release_rewards", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/referrals/flags/[key]", () => {
  beforeEach(() => {
    state.session = { adminUserId: "admin-1", email: "ops@akibamiles.com", role: "ops_admin" };
    state.updateError = null;
    state.audit.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    state.session = null;
    const res = await route.PATCH(makeRequest({ enabled: false }), { params: { key: "release_rewards" } });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown flag key", async () => {
    const res = await route.PATCH(makeRequest({ enabled: false }), { params: { key: "not_a_real_flag" } });
    expect(res.status).toBe(404);
  });

  it("rejects a non-boolean enabled value", async () => {
    const res = await route.PATCH(makeRequest({ enabled: "false" }), { params: { key: "release_rewards" } });
    expect(res.status).toBe(400);
  });

  it("disables the flag, records who changed it, and writes a distinct audit action per direction", async () => {
    const res = await route.PATCH(makeRequest({ enabled: false }), { params: { key: "release_rewards" } });
    expect(res.status).toBe(200);
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "referral.flag.disabled", targetId: "release_rewards" }),
    );
  });

  it("uses the 'enabled' audit action when turning a flag back on", async () => {
    await route.PATCH(makeRequest({ enabled: true }), { params: { key: "accept_clicks" } });
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "referral.flag.enabled", targetId: "accept_clicks" }),
    );
  });
});
