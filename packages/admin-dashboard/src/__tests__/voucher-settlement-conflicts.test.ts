import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), audit: vi.fn(), error: null as { code: string; message: string } | null }));
vi.mock("@/lib/auth", () => ({
  requireAdminSession: async () => ({ adminUserId: "11111111-1111-4111-8111-111111111111", role: "super_admin" }),
  adminIdForWrite: (s: { adminUserId: string }) => s.adminUserId,
}));
vi.mock("@/lib/audit", () => ({ writeAdminAuditLog: state.audit }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  rpc: state.rpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "22222222-2222-4222-8222-222222222222", state: "submitted", total_amount_minor: 10000, created_by: "other" } }) }) }) }),
} }));
vi.mock("@/lib/adminSettings", () => ({ getAdminSettings: async () => ({}) }));
const { POST } = await import("@/app/api/admin/voucher-reimbursements/route");
const { messageForRpcError } = await import("@/lib/voucherFunds");

describe("settlement conflict reporting", () => {
  beforeEach(() => { vi.clearAllMocks(); state.rpc.mockReturnValue({ single: async () => ({ data: null, error: state.error }) }); });
  it.each(["submit_batch","mark_paid"])("gives recovery instructions for stale %s and writes no success audit", async action => {
    state.error = { code: "P0001", message: "BATCH_PAYABLES_CHANGED" };
    const response = await POST(new Request("http://localhost/api/admin/voucher-reimbursements", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify({ action, batch_id: "22222222-2222-4222-8222-222222222222", confirmed_total_minor: 10000, payment_reference: "TEST", payment_evidence_ref: "TEST" }) }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("BATCH_PAYABLES_CHANGED");
    expect(body.error).toContain("Cancel");
    expect(body.error).not.toBe("BATCH_PAYABLES_CHANGED");
    expect(state.audit).not.toHaveBeenCalled();
  });
  it.each(["40001","40P01"])("reports SQL conflict %s as retryable, not a successful payment", async code => {
    state.error = { code, message: "SQL conflict" };
    const response = await POST(new Request("http://localhost/api/admin/voucher-reimbursements", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify({ action: "mark_paid", batch_id: "22222222-2222-4222-8222-222222222222", confirmed_total_minor: 10000, payment_reference: "TEST", payment_evidence_ref: "TEST" }) }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("SETTLEMENT_RETRY_REQUIRED");
    expect(body.error).toContain("Reload");
    expect(state.audit).not.toHaveBeenCalled();
  });
  it("translates the database stale-batch code", () => {
    expect(messageForRpcError({ message: "BATCH_PAYABLES_CHANGED" })).toContain("current payables");
  });
});
