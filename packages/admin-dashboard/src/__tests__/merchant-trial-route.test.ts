import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  rpc: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAdminSession: async () => state.session,
  adminIdForWrite: (session: Record<string, unknown>) =>
    session.openAccess ? null : (session.adminUserId ?? null),
}));
vi.mock("@/lib/audit", () => ({ writeAdminAuditLog: state.audit }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: state.rpc } }));

const route = await import("@/app/api/admin/merchants/[id]/trial/route");
const MERCHANT_ID = "11111111-1111-4111-8111-111111111111";

function post(body: unknown) {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("merchant onboarding trial route", () => {
  beforeEach(() => {
    state.session = null;
    state.rpc.mockReset();
    state.audit.mockReset();
  });

  it("rejects callers without merchant write access", async () => {
    const response = await route.POST(post({ days: 2 }), { params: { id: MERCHANT_ID } });
    expect(response.status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("requires a whole number from 1 to 30", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    const response = await route.POST(post({ days: 31 }), { params: { id: MERCHANT_ID } });
    expect(response.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("defaults to a two-day trial when days is omitted", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.rpc.mockResolvedValue({
      data: [{
        ok: true,
        subscription_id: "sub-1",
        status: "trialing",
        trial_starts_at: "2026-10-06T10:00:00Z",
        trial_ends_at: "2026-10-08T10:00:00Z",
      }],
      error: null,
    });

    const response = await route.POST(post({}), { params: { id: MERCHANT_ID } });
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "admin_grant_partner_trial",
      expect.objectContaining({ p_days: 2 }),
    );
  });

  it("grants the requested trial and records an audit event", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.rpc.mockResolvedValue({
      data: [{
        ok: true,
        subscription_id: "sub-1",
        status: "trialing",
        trial_starts_at: "2026-10-06T10:00:00Z",
        trial_ends_at: "2026-10-08T10:00:00Z",
      }],
      error: null,
    });

    const response = await route.POST(post({ days: 2 }), { params: { id: MERCHANT_ID } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.trialEndsAt).toBe("2026-10-08T10:00:00Z");
    expect(state.rpc).toHaveBeenCalledWith("admin_grant_partner_trial", {
      p_partner_id: MERCHANT_ID,
      p_admin_id: "admin-1",
      p_days: 2,
    });
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "merchant.trial_granted", targetId: MERCHANT_ID }),
    );
  });

  it("does not replace an existing paid subscription", async () => {
    state.session = { adminUserId: "admin-1", role: "ops_admin" };
    state.rpc.mockResolvedValue({
      data: [{ ok: false, error_code: "PAID_SUBSCRIPTION_EXISTS" }],
      error: null,
    });

    const response = await route.POST(post({ days: 2 }), { params: { id: MERCHANT_ID } });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("paid subscription");
    expect(state.audit).not.toHaveBeenCalled();
  });
});
