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

const route = await import("@/app/api/admin/push-campaigns/route");

function request(body: Record<string, unknown>, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/admin/push-campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

const validBody = {
  campaignType: "merchant",
  title: "A new merchant just landed",
  body: "Meet the newest place to earn and spend AkibaMiles.",
  deepLink: "/merchants/new-partner",
  idempotencyKey: "campaign-request-1",
};

describe("POST /api/admin/push-campaigns", () => {
  beforeEach(() => {
    state.session = null;
    state.rpc.mockReset();
    state.audit.mockReset();
  });

  it("requires notification write permission", async () => {
    expect((await route.POST(request(validBody))).status).toBe(401);
  });

  it("rejects cross-origin and invalid campaign content", async () => {
    state.session = { adminUserId: "admin-1", email: "ops@akibamiles.com", role: "ops_admin" };
    expect((await route.POST(request(validBody, "https://evil.example"))).status).toBe(403);
    expect((await route.POST(request({ ...validBody, deepLink: "https://evil.example" }))).status).toBe(400);
    expect((await route.POST(request({ ...validBody, body: "x".repeat(161) }))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("queues an opt-in campaign through the database RPC and audits it", async () => {
    state.session = { adminUserId: "admin-1", email: "ops@akibamiles.com", role: "ops_admin" };
    state.rpc.mockResolvedValue({
      data: [{ campaign_id: "campaign-1", audience_count: 12, queued_count: 12 }],
      error: null,
    });

    const response = await route.POST(request(validBody));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      campaignId: "campaign-1",
      audienceCount: 12,
      queuedCount: 12,
    });
    expect(state.rpc).toHaveBeenCalledWith("create_web_push_campaign", {
      p_campaign_type: "merchant",
      p_title: validBody.title,
      p_body: validBody.body,
      p_deep_link: validBody.deepLink,
      p_created_by: "ops@akibamiles.com",
      p_idempotency_key: validBody.idempotencyKey,
    });
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
      adminUserId: "admin-1",
      action: "push_campaign.queued",
      targetId: "campaign-1",
      metadata: expect.objectContaining({ queuedCount: 12 }),
    }));
  });

  it("does not write an audit row when queue creation fails", async () => {
    state.session = { adminUserId: "admin-1", email: "ops@akibamiles.com", role: "ops_admin" };
    state.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    expect((await route.POST(request(validBody))).status).toBe(500);
    expect(state.audit).not.toHaveBeenCalled();
  });
});
