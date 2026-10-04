import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  requiredPermission: null as string | null,
  rpc: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAdminSession: async (permission: string) => {
    state.requiredPermission = permission;
    return state.session;
  },
  adminIdForWrite: (session: Record<string, unknown>) =>
    session.openAccess ? null : session.adminUserId,
}));
vi.mock("@/lib/audit", () => ({ writeAdminAuditLog: state.audit }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: state.rpc } }));

const { POST } = await import("@/app/api/admin/discovery-photos/[id]/suppress/route");

const photoId = "20000000-0000-4000-8000-000000000002";
const adminId = "10000000-0000-4000-8000-000000000001";

function request(body: unknown, origin = "http://localhost"): Request {
  return new Request(`http://localhost/api/admin/discovery-photos/${photoId}/suppress`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/discovery-photos/[id]/suppress", () => {
  beforeEach(() => {
    state.session = { adminUserId: adminId, role: "ops_admin" };
    state.requiredPermission = null;
    state.rpc.mockReset();
    state.audit.mockReset();
    state.rpc.mockResolvedValue({ data: [{ ok: true, photo: { id: photoId, suppressed_at: "2026-01-01T00:00:00Z" } }], error: null });
    state.audit.mockResolvedValue(undefined);
  });

  it("requires discovery write permission", async () => {
    state.session = null;
    const response = await POST(request({ suppressed: true }), { params: { id: photoId } });
    expect(response.status).toBe(401);
    expect(state.requiredPermission).toBe("discovery.write");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request", async () => {
    const response = await POST(request({ suppressed: true }, "http://evil.example"), { params: { id: photoId } });
    expect(response.status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("suppresses, passing the actor id, correlation id and reason through to the RPC", async () => {
    const response = await POST(request({ suppressed: true, reasonCode: "legal_request" }), { params: { id: photoId } });

    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("set_visit_photo_suppression", expect.objectContaining({
      p_photo_id: photoId,
      p_suppressed: true,
      p_actor_id: adminId,
      p_reason_code: "legal_request",
    }));
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
      adminUserId: adminId,
      action: "discovery_photo.suppress",
      targetType: "merchant_visit_photo",
      targetId: photoId,
    }));
  });

  it("unsuppresses without requiring a reason", async () => {
    const response = await POST(request({ suppressed: false }), { params: { id: photoId } });
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("set_visit_photo_suppression", expect.objectContaining({
      p_suppressed: false, p_reason_code: null,
    }));
  });

  it("rejects a non-boolean suppressed field", async () => {
    const response = await POST(request({ suppressed: "yes" }), { params: { id: photoId } });
    expect(response.status).toBe(422);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("maps a redundant transition to 409 without writing an audit row", async () => {
    state.rpc.mockResolvedValue({ data: [{ ok: false, error_code: "invalid_transition" }], error: null });
    const response = await POST(request({ suppressed: true }), { params: { id: photoId } });
    expect(response.status).toBe(409);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("maps rate limiting to 429", async () => {
    state.rpc.mockResolvedValue({ data: [{ ok: false, error_code: "rate_limited" }], error: null });
    const response = await POST(request({ suppressed: true }), { params: { id: photoId } });
    expect(response.status).toBe(429);
  });

  it("requires a named actor even in open-access development mode", async () => {
    state.session = { adminUserId: "open-access", role: "super_admin", openAccess: true };
    const response = await POST(request({ suppressed: true }), { params: { id: photoId } });
    expect(response.status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
