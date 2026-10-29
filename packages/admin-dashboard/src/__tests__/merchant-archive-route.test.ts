import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ session: null as Record<string, unknown> | null, rpc: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdminSession: async (permission: string) => permission === "merchants.write" ? state.session : null,
  adminIdForWrite: (session: Record<string, unknown>) => session.openAccess ? null : session.adminUserId,
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: state.rpc } }));
const { POST } = await import("@/app/api/admin/merchants/[id]/archive/route");
const id = "11111111-1111-4111-8111-111111111111";
const request = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const valid = { confirmationName: "Shop", reason: "Inactive test merchant" };
describe("merchant removal", () => {
  beforeEach(() => { state.session = { adminUserId: "admin-1" }; state.rpc.mockReset(); });
  it("requires write authorization", async () => {
    state.session = null;
    expect((await POST(request(valid), { params: { id } })).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("validates the merchant id and reason before writing", async () => {
    expect((await POST(request(valid), { params: { id: "bad" } })).status).toBe(400);
    expect((await POST(request({ ...valid, reason: " " }), { params: { id } })).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON", async () => {
    expect((await POST(new Request("http://localhost/x", { method: "POST", body: "{" }), { params: { id } })).status).toBe(400);
  });
  it("archives through the atomic audited operation", async () => {
    state.rpc.mockResolvedValue({ data: "OK", error: null });
    expect((await POST(request(valid), { params: { id } })).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("admin_archive_merchant", {
      p_partner_id: id, p_admin_id: "admin-1", p_confirmation_name: "Shop", p_reason: valid.reason,
    });
  });
  it.each([["NAME_MISMATCH", 409], ["NOT_FOUND", 404], ["ALREADY_ARCHIVED", 200]])("handles %s", async (data, status) => {
    state.rpc.mockResolvedValue({ data, error: null });
    expect((await POST(request(valid), { params: { id } })).status).toBe(status);
  });
  it("does not report success when the transaction fails", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "audit failure" } });
    expect((await POST(request(valid), { params: { id } })).status).toBe(500);
  });
});
