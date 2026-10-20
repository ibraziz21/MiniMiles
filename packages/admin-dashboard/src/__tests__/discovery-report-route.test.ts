import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ session: { adminUserId: "admin", openAccess: false } as { adminUserId: string; openAccess: boolean } | null, rpc: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdminSession: state.auth, adminIdForWrite: (s: { adminUserId: string; openAccess: boolean }) => s.openAccess ? null : s.adminUserId }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: state.rpc } }));
const { POST } = await import("@/app/api/admin/discovery-reports/[id]/route");
const id = "20000000-0000-4000-8000-000000000002";
function request(body: unknown, origin = "http://localhost") { return new Request("http://localhost/api/admin/discovery-reports/" + id, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
describe("report resolution authorization and outcomes", () => {
  beforeEach(() => { state.session = { adminUserId: "admin", openAccess: false }; state.auth.mockReset().mockImplementation(() => state.session); state.rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null }); });
  it("requires server-side discovery write access", async () => { state.session = null; expect((await POST(request({}), { params: { id } })).status).toBe(401); expect(state.auth).toHaveBeenCalledWith("discovery.write"); expect(state.rpc).not.toHaveBeenCalled(); });
  it("rejects cross-origin mutations", async () => { expect((await POST(request({ action: "dismiss", reason: "no_violation" }, "https://evil.example"), { params: { id } })).status).toBe(403); expect(state.rpc).not.toHaveBeenCalled(); });
  it("rejects anonymous open-access writes", async () => { state.session!.openAccess = true; expect((await POST(request({}), { params: { id } })).status).toBe(403); expect(state.rpc).not.toHaveBeenCalled(); });
  it("validates ids before database access", async () => { expect((await POST(request({}), { params: { id: "invalid" } })).status).toBe(400); expect(state.rpc).not.toHaveBeenCalled(); });
  it.each([{ action: "dismiss", reason: "policy_violation" }, { action: "hide_visit", reason: "no_violation" }, { action: "delete_user", reason: "other" }])("rejects invalid resolution %j", async body => { expect((await POST(request(body), { params: { id } })).status).toBe(422); expect(state.rpc).not.toHaveBeenCalled(); });
  it("passes only bounded decisions and the server actor to the atomic RPC", async () => { const response = await POST(request({ action: "hide_visit", reason: "policy_violation", actor: "forged" }), { params: { id } }); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(state.rpc).toHaveBeenCalledWith("resolve_verified_visit_report", expect.objectContaining({ p_report_id: id, p_action: "hide_visit", p_actor_id: "admin", p_correlation_id: expect.any(String) })); });
  it("returns conflict for an already resolved report", async () => { state.rpc.mockResolvedValue({ data: { ok: false, error_code: "already_resolved" }, error: null }); expect((await POST(request({ action: "dismiss", reason: "no_violation" }), { params: { id } })).status).toBe(409); });
  it("does not expose database error contents", async () => { state.rpc.mockResolvedValue({ data: null, error: { message: "private member data" } }); const response = await POST(request({ action: "hide_photo", reason: "other" }), { params: { id } }); expect(response.status).toBe(500); expect(await response.text()).not.toContain("private member data"); });
});
