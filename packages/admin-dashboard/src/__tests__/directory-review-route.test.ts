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

const route = await import("@/app/api/admin/directory-reviews/[id]/route");

const merchantId = "20000000-0000-4000-8000-000000000002";
const adminId = "10000000-0000-4000-8000-000000000001";

function request(body: unknown): Request {
  return new Request(`http://localhost/api/admin/directory-reviews/${merchantId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/directory-reviews/[id]", () => {
  beforeEach(() => {
    state.session = { adminUserId: adminId, role: "ops_admin" };
    state.requiredPermission = null;
    state.rpc.mockReset();
    state.audit.mockReset();
    state.rpc.mockResolvedValue({
      data: { status: "published", updatedAt: "2026-07-30T12:00:00Z" },
      error: null,
    });
    state.audit.mockResolvedValue(undefined);
  });

  it("requires merchant write permission", async () => {
    state.session = null;

    const response = await route.POST(request({ action: "publish" }), {
      params: { id: merchantId },
    });

    expect(response.status).toBe(401);
    expect(state.requiredPermission).toBe("merchants.write");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("derives the reviewer from the admin session and records both audit trails", async () => {
    const response = await route.POST(
      request({
        action: "publish",
        affectedSections: ["business"],
        internalNote: "Verified the registration and branch details.",
      }),
      { params: { id: merchantId } },
    );

    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("perform_merchant_directory_transition", {
      p_partner_id: merchantId,
      p_action: "publish",
      p_actor_user_id: adminId,
      p_actor_type: "internal_admin",
      p_affected_sections: ["business"],
      p_merchant_safe_message: null,
      p_internal_note: "Verified the registration and branch details.",
    });
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
      adminUserId: adminId,
      action: "merchant.directory.publish",
      targetType: "merchant",
      targetId: merchantId,
    }));
  });

  it("rejects caller-supplied reviewer identity", async () => {
    const response = await route.POST(
      request({ action: "publish", actorAdminId: "30000000-0000-4000-8000-000000000003" }),
      { params: { id: merchantId } },
    );

    expect(response.status).toBe(422);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("requires a merchant-visible message when requesting changes", async () => {
    const response = await route.POST(
      request({ action: "request_changes", affectedSections: ["locations"] }),
      { params: { id: merchantId } },
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "Add a message the merchant can see before taking this action.",
    });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("maps stale lifecycle actions to a conflict without writing an admin audit row", async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "invalid_transition" },
    });

    const response = await route.POST(request({ action: "publish" }), {
      params: { id: merchantId },
    });

    expect(response.status).toBe(409);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("allows open-access development sessions without inventing an actor ID", async () => {
    state.session = { adminUserId: "open-access", role: "super_admin", openAccess: true };

    const response = await route.POST(request({ action: "publish" }), {
      params: { id: merchantId },
    });

    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith(
      "perform_merchant_directory_transition",
      expect.objectContaining({ p_actor_user_id: null }),
    );
  });
});
