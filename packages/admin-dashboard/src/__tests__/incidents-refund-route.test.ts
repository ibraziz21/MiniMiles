import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  rpc: vi.fn(),
  audit: vi.fn(),
  incident: null as Record<string, unknown> | null,
  insertError: null as { code?: string; message?: string } | null,
}));

vi.mock("@/lib/auth", () => ({
  requireAdminSession: async () => state.session,
  adminIdForWrite: (session: Record<string, unknown>) => session.adminUserId ?? null,
}));
vi.mock("@/lib/audit", () => ({ writeAdminAuditLog: state.audit }));
vi.mock("@/lib/supabase", () => {
  function chain() {
    const value: Record<string, unknown> = {
      select: () => value,
      eq: () => value,
      maybeSingle: async () => ({ data: state.incident, error: null }),
      insert: async () => ({ error: state.insertError }),
    };
    return value;
  }
  return { supabase: { from: () => chain(), rpc: state.rpc } };
});

const route = await import("@/app/api/admin/incidents/[id]/refund/route");

function makeRequest(): Request {
  return new Request("http://localhost/api/admin/incidents/incident-1/refund", { method: "POST" });
}

describe("POST /api/admin/incidents/[id]/refund", () => {
  beforeEach(() => {
    state.session = { adminUserId: "admin-1" };
    state.rpc.mockReset();
    state.audit.mockReset();
    state.insertError = null;
    state.incident = {
      id: "incident-1",
      voucher_id: null,
      resolved: false,
      data: { payment_method: "onchain_transfer", user_address: "0xbuyer" },
    };
  });

  it("claims the incident before inserting the refund row (prevents the recovery/refund race)", async () => {
    const calls: string[] = [];
    state.rpc.mockImplementation((name: string) => {
      calls.push(name);
      if (name === "claim_reconciliation_incident") return Promise.resolve({ data: [{ ok: true, error_code: "" }], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await route.POST(makeRequest(), { params: { id: "incident-1" } });
    expect(res.status).toBe(200);

    const claimIdx = calls.indexOf("claim_reconciliation_incident");
    expect(claimIdx).toBe(0);
    expect(calls).toContain("resolve_reconciliation_incident");
  });

  it("returns 409 without touching the refund table when the incident is already claimed", async () => {
    state.rpc.mockImplementation((name: string) => {
      if (name === "claim_reconciliation_incident") {
        return Promise.resolve({ data: [{ ok: false, error_code: "ALREADY_CLAIMED" }], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const res = await route.POST(makeRequest(), { params: { id: "incident-1" } });
    const json = await res.json() as { error: string };

    expect(res.status).toBe(409);
    expect(json.error).toBe("ALREADY_CLAIMED");
    expect(state.rpc).not.toHaveBeenCalledWith("resolve_reconciliation_incident", expect.anything());
  });

  it("releases the claim and returns 409 if the payment was already refunded (unique violation)", async () => {
    state.insertError = { code: "23505", message: "duplicate key" };
    const calls: string[] = [];
    state.rpc.mockImplementation((name: string) => {
      calls.push(name);
      if (name === "claim_reconciliation_incident") return Promise.resolve({ data: [{ ok: true, error_code: "" }], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await route.POST(makeRequest(), { params: { id: "incident-1" } });
    const json = await res.json() as { error: string };

    expect(res.status).toBe(409);
    expect(json.error).toBe("This payment has already been refunded");
    expect(calls).toContain("release_reconciliation_incident_claim");
    expect(calls).not.toContain("resolve_reconciliation_incident");
  });
});
